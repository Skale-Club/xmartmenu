/**
 * Superadmin › AI & billing: the global OpenRouter key (default for every
 * client and fallback), default billing mode, margin and USD→BRL rate, plus a
 * per-client overview of this month's usage.
 */
import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { loadPlatformAiSettings } from '@/lib/ai/access'
import { parseBillingMode, clampMarkup } from '@/lib/ai/billing-rules'
import { maskedOrEmpty, nextStoredKey, startOfMonthIso, usageByTenant, verifyOpenRouterKey } from '@/lib/ai/settings-service'

export const dynamic = 'force-dynamic'

async function handleGET() {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceClient()
  const [platform, { data: tenants }, { data: tenantSettings }, usage] = await Promise.all([
    loadPlatformAiSettings(),
    service.from('tenants').select('id, name, slug').order('name'),
    service.from('tenant_ai_settings').select('tenant_id, billing_mode, openrouter_api_key, markup_pct, last_key_error, last_key_error_at'),
    usageByTenant(startOfMonthIso()),
  ])
  const byTenant = new Map((tenantSettings ?? []).map(t => [t.tenant_id as string, t]))
  return NextResponse.json({
    settings: {
      openrouter_api_key: maskedOrEmpty(platform.platformKeySource === 'panel' ? platform.platformKey : null),
      key_source: platform.platformKeySource,
      default_billing_mode: platform.defaultMode,
      default_markup_pct: platform.defaultMarkupPct,
      usd_to_brl: platform.usdToBrl,
    },
    platform_usage: usage.get(null) ?? null,
    tenants: (tenants ?? []).map(t => {
      const row = byTenant.get(t.id)
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        billing_mode: parseBillingMode(row?.billing_mode) ?? null,
        effective_mode: parseBillingMode(row?.billing_mode) ?? platform.defaultMode,
        has_key: !!row?.openrouter_api_key,
        markup_pct: row?.markup_pct == null ? null : Number(row.markup_pct),
        last_key_error: row?.last_key_error ?? null,
        last_key_error_at: row?.last_key_error_at ?? null,
        month: usage.get(t.id) ?? null,
      }
    }),
  })
}

async function handlePUT(request: Request) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  const key = nextStoredKey(body.openrouter_api_key)
  if (key !== undefined) update.openrouter_api_key = key
  if (body.default_billing_mode !== undefined) {
    const mode = parseBillingMode(body.default_billing_mode)
    if (!mode) return NextResponse.json({ error: 'Invalid billing mode' }, { status: 400 })
    update.default_billing_mode = mode
  }
  if (body.default_markup_pct !== undefined) {
    const markup = Number(body.default_markup_pct)
    if (!Number.isFinite(markup) || markup < 0 || markup > 1000) return NextResponse.json({ error: 'Margin must be between 0 and 1000%' }, { status: 400 })
    update.default_markup_pct = clampMarkup(markup)
  }
  if (body.usd_to_brl !== undefined) {
    const rate = Number(body.usd_to_brl)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return NextResponse.json({ error: 'Invalid USD→BRL rate' }, { status: 400 })
    update.usd_to_brl = rate
  }

  const { error } = await createServiceClient().from('platform_ai_settings').upsert({ id: 1, ...update }, { onConflict: 'id' })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return handleGET()
}

/** { action: 'test', api_key? } — checks the given key, or the stored global one. */
async function handlePOST(request: Request) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { action?: string; api_key?: string }
  if (body.action !== 'test') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const candidate = body.api_key?.trim() && !body.api_key.includes('••') ? body.api_key.trim() : (await loadPlatformAiSettings()).platformKey
  if (!candidate) return NextResponse.json({ ok: false, error: 'No global key configured' })
  return NextResponse.json(await verifyOpenRouterKey(candidate))
}

export const GET = withApi('GET /api/superadmin/ai/settings', handleGET)
export const PUT = withApi('PUT /api/superadmin/ai/settings', handlePUT)
export const POST = withApi('POST /api/superadmin/ai/settings', handlePOST)
