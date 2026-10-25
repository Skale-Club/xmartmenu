/**
 * Shared by the AI settings routes (superadmin global + per client, and the
 * restaurant's own page): key input handling, key verification against
 * OpenRouter, and usage summaries.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { encryptApiKey, maskApiKey } from '@/lib/crypto'
import { OPENROUTER_BASE_URL } from './openrouter'

/** Masked values (what the panel shows) mean "keep the stored key". */
export function isMaskedKey(value: string): boolean {
  return value.includes('••')
}

/**
 * The new stored value for a key field: undefined = leave as is, null =
 * remove, otherwise the encrypted new key.
 */
export function nextStoredKey(input: unknown): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null || input === '') return null
  if (typeof input !== 'string') return undefined
  const key = input.trim()
  if (!key) return null
  if (isMaskedKey(key)) return undefined
  return encryptApiKey(key)
}

export function maskedOrEmpty(plain: string | null): string {
  return plain ? maskApiKey(plain) : ''
}

export interface KeyCheck {
  ok: boolean
  status?: number
  label?: string | null
  limitRemaining?: number | null
  error?: string
}

/** Asks OpenRouter whether a key works (GET /key: label, remaining limit). */
export async function verifyOpenRouterKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  try {
    const res = await fetchImpl(`${OPENROUTER_BASE_URL}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, status: res.status, error: res.status === 401 ? 'Invalid key' : `OpenRouter answered ${res.status}` }
    const body = (await res.json().catch(() => ({}))) as { data?: { label?: string; limit_remaining?: number | null } }
    return { ok: true, status: res.status, label: body.data?.label ?? null, limitRemaining: body.data?.limit_remaining ?? null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not reach OpenRouter' }
  }
}

export interface UsageSummary {
  calls: number
  costUsd: number
  chargeUsd: number
  /** Billable and not yet on an invoice. */
  unbilledChargeUsd: number
  byKey: { tenant: number; platform: number }
}

/** Usage since a date, for one client or (tenantId undefined) per client. */
export async function usageByTenant(sinceIso: string, tenantId?: string): Promise<Map<string | null, UsageSummary>> {
  let query = createServiceClient()
    .from('ai_usage_events')
    .select('tenant_id, key_source, billable, cost_usd, charge_usd, invoiced_at')
    .gte('occurred_at', sinceIso)
    .limit(100_000)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data, error } = await query
  if (error) throw error
  const out = new Map<string | null, UsageSummary>()
  for (const row of data ?? []) {
    const key = (row.tenant_id as string | null) ?? null
    const s = out.get(key) ?? { calls: 0, costUsd: 0, chargeUsd: 0, unbilledChargeUsd: 0, byKey: { tenant: 0, platform: 0 } }
    s.calls++
    s.costUsd += Number(row.cost_usd)
    s.chargeUsd += Number(row.charge_usd)
    if (row.billable && !row.invoiced_at) s.unbilledChargeUsd += Number(row.charge_usd)
    s.byKey[row.key_source === 'tenant' ? 'tenant' : 'platform']++
    out.set(key, s)
  }
  return out
}

/** All unbilled billable usage of a client, whatever the date. */
export async function unbilledChargeUsd(tenantId: string): Promise<number> {
  const { data } = await createServiceClient()
    .from('ai_usage_events')
    .select('charge_usd')
    .eq('tenant_id', tenantId)
    .eq('billable', true)
    .is('invoiced_at', null)
    .limit(100_000)
  return (data ?? []).reduce((sum, r) => sum + Number(r.charge_usd), 0)
}

export function startOfMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}
