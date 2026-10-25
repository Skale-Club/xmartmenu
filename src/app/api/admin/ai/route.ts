/**
 * The restaurant's own AI page (owner only): paste or remove their OpenRouter
 * key and see this month's usage. Saving a key switches the client to
 * "own key" (they pay OpenRouter directly); removing it goes back to the
 * platform default. Margins and modes beyond that are set by the superadmin.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { loadPlatformAiSettings, loadTenantAiSettings } from '@/lib/ai/access'
import { maskedOrEmpty, nextStoredKey, startOfMonthIso, usageByTenant, verifyOpenRouterKey } from '@/lib/ai/settings-service'

export const dynamic = 'force-dynamic'

async function owner() {
  const effective = await getEffectiveTenant()
  if (!effective) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (effective.role === 'store-staff') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { tenantId: effective.tenantId }
}

async function payload(tenantId: string) {
  const [platform, tenant, usage] = await Promise.all([
    loadPlatformAiSettings(),
    loadTenantAiSettings(tenantId),
    usageByTenant(startOfMonthIso(), tenantId),
  ])
  const month = usage.get(tenantId) ?? null
  return {
    effective_mode: tenant.mode ?? platform.defaultMode,
    openrouter_api_key: maskedOrEmpty(tenant.key),
    last_key_error: tenant.lastKeyError,
    last_key_error_at: tenant.lastKeyErrorAt,
    usd_to_brl: platform.usdToBrl,
    month: month && { calls: month.calls, charge_usd: month.chargeUsd, calls_on_own_key: month.byKey.tenant },
  }
}

async function handleGET() {
  const who = await owner()
  if ('error' in who && who.error) return who.error
  return NextResponse.json(await payload(who.tenantId!))
}

async function handlePUT(request: Request) {
  const who = await owner()
  if ('error' in who && who.error) return who.error
  const body = (await request.json().catch(() => ({}))) as { openrouter_api_key?: unknown }
  const key = nextStoredKey(body.openrouter_api_key)
  if (key === undefined) return NextResponse.json(await payload(who.tenantId!))
  const { error } = await createServiceClient().from('tenant_ai_settings').upsert({
    tenant_id: who.tenantId,
    openrouter_api_key: key,
    billing_mode: key ? 'own_key' : null,
    last_key_error: null,
    last_key_error_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json(await payload(who.tenantId!))
}

/** { action: 'test', api_key? } */
async function handlePOST(request: Request) {
  const who = await owner()
  if ('error' in who && who.error) return who.error
  const body = (await request.json().catch(() => ({}))) as { action?: string; api_key?: string }
  if (body.action !== 'test') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const candidate = body.api_key?.trim() && !body.api_key.includes('••') ? body.api_key.trim() : (await loadTenantAiSettings(who.tenantId!)).key
  if (!candidate) return NextResponse.json({ ok: false, error: 'No key to test' })
  return NextResponse.json(await verifyOpenRouterKey(candidate))
}

export const GET = withApi('GET /api/admin/ai', handleGET)
export const PUT = withApi('PUT /api/admin/ai', handlePUT)
export const POST = withApi('POST /api/admin/ai', handlePOST)
