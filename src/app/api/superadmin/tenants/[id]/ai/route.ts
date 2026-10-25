/**
 * Superadmin › client › AI: billing mode, the client's OpenRouter key, margin
 * override, this month's usage, and actions (test key, bill now).
 */
import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { loadPlatformAiSettings, loadTenantAiSettings } from '@/lib/ai/access'
import { billAiUsage } from '@/lib/ai/billing'
import { parseBillingMode, clampMarkup } from '@/lib/ai/billing-rules'
import { maskedOrEmpty, nextStoredKey, startOfMonthIso, unbilledChargeUsd, usageByTenant, verifyOpenRouterKey } from '@/lib/ai/settings-service'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function tenantAiPayload(tenantId: string) {
  const [platform, tenant, usage, unbilled, { data: sub }] = await Promise.all([
    loadPlatformAiSettings(),
    loadTenantAiSettings(tenantId),
    usageByTenant(startOfMonthIso(), tenantId),
    unbilledChargeUsd(tenantId),
    createServiceClient().from('tenant_subscriptions').select('stripe_customer_id').eq('tenant_id', tenantId).maybeSingle(),
  ])
  return {
    billing_mode: tenant.mode,
    effective_mode: tenant.mode ?? platform.defaultMode,
    openrouter_api_key: maskedOrEmpty(tenant.key),
    markup_pct: tenant.markupPct,
    effective_markup_pct: tenant.markupPct ?? platform.defaultMarkupPct,
    last_key_error: tenant.lastKeyError,
    last_key_error_at: tenant.lastKeyErrorAt,
    global_key_configured: platform.platformKeySource !== 'none',
    usd_to_brl: platform.usdToBrl,
    month: usage.get(tenantId) ?? null,
    unbilled_charge_usd: unbilled,
    can_bill: !!sub?.stripe_customer_id,
  }
}

async function handleGET(_request: Request, { params }: Ctx) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  return NextResponse.json(await tenantAiPayload(id))
}

async function handlePUT(request: Request, { params }: Ctx) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const row: Record<string, unknown> = { tenant_id: id, updated_at: new Date().toISOString() }

  if (body.billing_mode !== undefined) {
    if (body.billing_mode === null || body.billing_mode === '') row.billing_mode = null
    else {
      const mode = parseBillingMode(body.billing_mode)
      if (!mode) return NextResponse.json({ error: 'Invalid billing mode' }, { status: 400 })
      row.billing_mode = mode
    }
  }
  if (body.markup_pct !== undefined) {
    if (body.markup_pct === null || body.markup_pct === '') row.markup_pct = null
    else {
      const markup = Number(body.markup_pct)
      if (!Number.isFinite(markup) || markup < 0 || markup > 1000) return NextResponse.json({ error: 'Margin must be between 0 and 1000%' }, { status: 400 })
      row.markup_pct = clampMarkup(markup)
    }
  }
  const key = nextStoredKey(body.openrouter_api_key)
  if (key !== undefined) {
    row.openrouter_api_key = key
    // A new key clears the old failure warning.
    row.last_key_error = null
    row.last_key_error_at = null
  }

  const { error } = await createServiceClient().from('tenant_ai_settings').upsert(row, { onConflict: 'tenant_id' })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json(await tenantAiPayload(id))
}

/** { action: 'test', api_key? } | { action: 'bill' } */
async function handlePOST(request: Request, { params }: Ctx) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { action?: string; api_key?: string }
  if (body.action === 'test') {
    const candidate = body.api_key?.trim() && !body.api_key.includes('••') ? body.api_key.trim() : (await loadTenantAiSettings(id)).key
    if (!candidate) return NextResponse.json({ ok: false, error: 'This client has no key' })
    return NextResponse.json(await verifyOpenRouterKey(candidate))
  }
  if (body.action === 'bill') {
    try {
      return NextResponse.json(await billAiUsage({ tenantId: id }))
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Billing failed' }, { status: 502 })
    }
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export const GET = withApi('GET /api/superadmin/tenants/[id]/ai', handleGET)
export const PUT = withApi('PUT /api/superadmin/tenants/[id]/ai', handlePUT)
export const POST = withApi('POST /api/superadmin/tenants/[id]/ai', handlePOST)
