/**
 * Server side of AI billing: which key serves a call, falling back to the
 * global key when a client's key is rejected, and recording the real cost of
 * every OpenRouter call (usage.cost) in ai_usage_events.
 *
 *   const access = await resolveAiAccess(tenantId, 'translation')
 *   if (!access) return 503
 *   const result = await runAi(access, choice =>
 *     translateMenuTexts(openRouterModel(choice.apiKey, model, access.fetchFor(choice, model)), req))
 *
 * Rules (who pays) are pure in ./billing-rules.ts.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'
import { getRequestContext } from '@/lib/observability/context'
import { log } from '@/lib/observability/log'
import {
  chargeFor,
  clampMarkup,
  isKeyRejection,
  parseBillingMode,
  planAiAccess,
  type AiBillingMode,
  type AiFeature,
  type KeyChoice,
} from './billing-rules'
import { platformOpenRouterKey } from './openrouter'

export interface PlatformAiSettings {
  platformKey: string | null
  /** Where the global key came from, for the panel. */
  platformKeySource: 'panel' | 'env' | 'none'
  defaultMode: AiBillingMode
  defaultMarkupPct: number
  usdToBrl: number
}

export interface TenantAiSettings {
  mode: AiBillingMode | null
  key: string | null
  markupPct: number | null
  lastKeyError: string | null
  lastKeyErrorAt: string | null
}

function decryptOrNull(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return decryptApiKey(value) || null
  } catch {
    return null
  }
}

export async function loadPlatformAiSettings(): Promise<PlatformAiSettings> {
  const { data } = await createServiceClient()
    .from('platform_ai_settings')
    .select('openrouter_api_key, default_billing_mode, default_markup_pct, usd_to_brl')
    .eq('id', 1)
    .maybeSingle()
  const panelKey = decryptOrNull(data?.openrouter_api_key)
  const envKey = platformOpenRouterKey()
  return {
    platformKey: panelKey ?? envKey,
    platformKeySource: panelKey ? 'panel' : envKey ? 'env' : 'none',
    defaultMode: parseBillingMode(data?.default_billing_mode) ?? 'platform',
    defaultMarkupPct: clampMarkup(Number(data?.default_markup_pct ?? 30)),
    usdToBrl: Number(data?.usd_to_brl ?? 5.5) || 5.5,
  }
}

export async function loadTenantAiSettings(tenantId: string): Promise<TenantAiSettings> {
  const { data } = await createServiceClient()
    .from('tenant_ai_settings')
    .select('billing_mode, openrouter_api_key, markup_pct, last_key_error, last_key_error_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return {
    mode: parseBillingMode(data?.billing_mode),
    key: decryptOrNull(data?.openrouter_api_key),
    markupPct: data?.markup_pct == null ? null : Number(data.markup_pct),
    lastKeyError: data?.last_key_error ?? null,
    lastKeyErrorAt: data?.last_key_error_at ?? null,
  }
}

export interface ResolvedAiAccess {
  tenantId: string | null
  feature: AiFeature
  primary: KeyChoice
  fallback: KeyChoice | null
  /** A fetch that records the call's real cost under this key choice. */
  fetchFor: (choice: KeyChoice, model?: string) => typeof fetch
}

export async function resolveAiAccess(tenantId: string | null, feature: AiFeature): Promise<ResolvedAiAccess | null> {
  const [platform, tenant] = await Promise.all([
    loadPlatformAiSettings(),
    tenantId ? loadTenantAiSettings(tenantId) : Promise.resolve(null),
  ])
  const plan = planAiAccess({
    feature,
    tenantId,
    tenantMode: tenant?.mode ?? null,
    tenantKey: tenant?.key ?? null,
    tenantMarkupPct: tenant?.markupPct ?? null,
    platformKey: platform.platformKey,
    defaultMode: platform.defaultMode,
    defaultMarkupPct: platform.defaultMarkupPct,
  })
  if (!plan) return null
  return {
    tenantId,
    feature,
    ...plan,
    fetchFor: (choice, model) => meteredFetch({ tenantId, feature, choice, model }),
  }
}

/** HTTP status of an AI SDK / OpenRouter error, through retry wrappers. */
export function errorStatus(error: unknown): number | null {
  const e = error as { statusCode?: unknown; status?: unknown; lastError?: unknown; cause?: unknown } | null
  if (!e || typeof e !== 'object') return null
  for (const value of [e.statusCode, e.status]) if (typeof value === 'number') return value
  return errorStatus(e.lastError) ?? errorStatus(e.cause)
}

/**
 * Runs the call with the primary key; if the client's key is rejected
 * (invalid / no credit / disabled) and a fallback exists, records why and
 * runs it again on the global key — billed to the client.
 */
export async function runAi<T>(access: ResolvedAiAccess, fn: (choice: KeyChoice) => Promise<T>): Promise<T> {
  try {
    return await fn(access.primary)
  } catch (error) {
    const status = errorStatus(error)
    if (!access.fallback || access.primary.keySource !== 'tenant' || !isKeyRejection(status)) throw error
    log.warn('ai.client_key_rejected', { feature: access.feature, status, tenant_id: access.tenantId })
    if (access.tenantId) {
      await createServiceClient()
        .from('tenant_ai_settings')
        .update({ last_key_error: `HTTP ${status}: ${error instanceof Error ? error.message.slice(0, 200) : 'rejected'}`, last_key_error_at: new Date().toISOString() })
        .eq('tenant_id', access.tenantId)
    }
    return fn(access.fallback)
  }
}

interface UsageMeta {
  tenantId: string | null
  feature: AiFeature
  choice: KeyChoice
  model?: string
}

/** Records one call from its OpenRouter response body (usage.cost in USD). */
export async function recordAiUsage(meta: UsageMeta, body: unknown): Promise<void> {
  const json = (body ?? {}) as { id?: unknown; model?: unknown; usage?: { cost?: unknown } }
  const cost = Math.max(0, Number(json.usage?.cost ?? 0) || 0)
  const { error } = await createServiceClient().from('ai_usage_events').insert({
    tenant_id: meta.tenantId,
    feature: meta.feature,
    model: typeof json.model === 'string' ? json.model : meta.model ?? null,
    key_source: meta.choice.keySource,
    billable: meta.choice.billable,
    cost_usd: cost,
    markup_pct: meta.choice.markupPct,
    charge_usd: chargeFor(cost, meta.choice.billable, meta.choice.markupPct),
    generation_id: typeof json.id === 'string' ? json.id : null,
    request_id: getRequestContext()?.requestId ?? null,
  })
  if (error) log.error('ai.usage_record_failed', { err: error, feature: meta.feature })
}

/**
 * fetch for OpenRouter that records each successful JSON response's cost.
 * The response is cloned, so the caller reads it untouched.
 */
export function meteredFetch(meta: UsageMeta): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    if (response.ok && (response.headers.get('content-type') ?? '').includes('application/json')) {
      // Wait for the record so a request's cost is in the ledger when it ends.
      await response.clone().json().then(body => recordAiUsage(meta, body)).catch(err => {
        log.error('ai.usage_parse_failed', { err, feature: meta.feature })
      })
    }
    return response
  }
}
