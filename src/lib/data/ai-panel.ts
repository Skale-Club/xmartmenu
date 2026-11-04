import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { authorizeAdminActor, type AdminActorContext } from './admin-actor'
import { clampMarkup, parseBillingMode } from '../ai/billing-rules'
import { nextStoredKey } from '../ai/settings-key'
import type { UsageSummary } from '../ai/settings-service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function object(input: unknown) { if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminMenuError(400, 'Invalid request'); return input as Record<string, unknown> }
function superadmin(context: AdminActorContext) { if (context.role !== 'superadmin') throw new AdminMenuError(403, 'Forbidden') }
function tenant(context: AdminActorContext): string { if (!context.tenantId || !UUID.test(context.tenantId)) throw new AdminMenuError(404, 'Tenant not found'); return context.tenantId }
function nonnegative(value: unknown) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new AdminMenuError(503, 'Usage is unavailable'); return number }

export async function readAiUsageSummary(query: AdminMenuQuery, sinceIso: string, tenantId?: string): Promise<Map<string | null, UsageSummary>> {
  if (!Number.isFinite(Date.parse(sinceIso)) || (tenantId !== undefined && !UUID.test(tenantId))) throw new AdminMenuError(400, 'Invalid usage scope')
  const result = await query(`SELECT tenant_id,count(*)::int AS calls,COALESCE(sum(cost_usd),0)::text AS cost_usd,COALESCE(sum(charge_usd),0)::text AS charge_usd,
    COALESCE(sum(charge_usd) FILTER(WHERE billable=true AND invoiced_at IS NULL),0)::text AS unbilled,
    (count(*) FILTER(WHERE key_source='tenant'))::int AS tenant_calls,(count(*) FILTER(WHERE key_source IS DISTINCT FROM 'tenant'))::int AS platform_calls
    FROM public.ai_usage_events WHERE occurred_at>=$1 AND ($2::uuid IS NULL OR tenant_id=$2) GROUP BY tenant_id LIMIT 10001`, [sinceIso, tenantId ?? null])
  if (result.rows.length > 10000) throw new AdminMenuError(503, 'Usage is unavailable')
  return new Map(result.rows.map(row => [row.tenant_id as string | null, { calls: nonnegative(row.calls), costUsd: nonnegative(row.cost_usd), chargeUsd: nonnegative(row.charge_usd), unbilledChargeUsd: nonnegative(row.unbilled), byKey: { tenant: nonnegative(row.tenant_calls), platform: nonnegative(row.platform_calls) } }]))
}
export async function readAiUnbilledCharge(query: AdminMenuQuery, tenantId: string) {
  if (!UUID.test(tenantId)) throw new AdminMenuError(400, 'Invalid usage scope')
  const result = await query('SELECT COALESCE(sum(charge_usd),0)::text AS amount FROM public.ai_usage_events WHERE tenant_id=$1 AND billable=true AND invoiced_at IS NULL', [tenantId])
  return nonnegative(result.rows[0]?.amount)
}
export async function readAiPanelTenants(query: AdminMenuQuery, context: AdminActorContext) {
  superadmin(context); await authorizeAdminActor(query, context)
  const result = await query(`SELECT t.id,t.name,t.slug,s.billing_mode,(s.openrouter_api_key IS NOT NULL AND s.openrouter_api_key<>'') AS has_key,
    s.markup_pct,s.last_key_error,s.last_key_error_at FROM public.tenants t LEFT JOIN public.tenant_ai_settings s ON s.tenant_id=t.id ORDER BY t.name LIMIT 10001`)
  if (result.rows.length > 10000) throw new AdminMenuError(503, 'Client list is unavailable')
  return result.rows.map(row => {
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.slug !== 'string') throw new AdminMenuError(503, 'Client list is unavailable')
    return { id: row.id, name: row.name, slug: row.slug, billing_mode: row.billing_mode, has_key: row.has_key === true,
      markup_pct: row.markup_pct, last_key_error: typeof row.last_key_error === 'string' ? row.last_key_error : null,
      last_key_error_at: row.last_key_error_at instanceof Date ? row.last_key_error_at.toISOString() : typeof row.last_key_error_at === 'string' ? row.last_key_error_at : null }
  })
}
export async function readAiBillingAvailability(query: AdminMenuQuery, context: AdminActorContext) {
  await authorizeAdminActor(query, context)
  const result = await query("SELECT (stripe_customer_id IS NOT NULL AND stripe_customer_id<>'') AS can_bill FROM public.tenant_subscriptions WHERE tenant_id=$1 LIMIT 2", [tenant(context)])
  if (result.rows.length > 1) throw new AdminMenuError(503, 'Billing information is unavailable')
  return result.rows[0]?.can_bill === true
}
export async function writeAiTenantSettings(query: AdminMenuQuery, context: AdminActorContext, input: unknown, ownerOnly: boolean) {
  if (!ownerOnly) superadmin(context)
  await authorizeAdminActor(query, context, true)
  const tenantId = tenant(context), body = object(input), key = nextStoredKey(body.openrouter_api_key)
  if (ownerOnly && key === undefined) return
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (ownerOnly) row.billing_mode = key ? 'own_key' : null
  else {
    if (body.billing_mode !== undefined) {
      const mode = body.billing_mode === null || body.billing_mode === '' ? null : parseBillingMode(body.billing_mode)
      if (mode === null && body.billing_mode !== null && body.billing_mode !== '') throw new AdminMenuError(400, 'Invalid billing mode')
      row.billing_mode = mode
    }
    if (body.markup_pct !== undefined) {
      if (body.markup_pct === null || body.markup_pct === '') row.markup_pct = null
      else { const markup = Number(body.markup_pct); if (!Number.isFinite(markup) || markup < 0 || markup > 1000) throw new AdminMenuError(400, 'Margin must be between 0 and 1000%'); row.markup_pct = clampMarkup(markup) }
    }
  }
  if (key !== undefined) { row.openrouter_api_key = key; row.last_key_error = null; row.last_key_error_at = null }
  const columns = Object.keys(row)
  await query(`INSERT INTO public.tenant_ai_settings(tenant_id,${columns.join(',')}) VALUES($1,${columns.map((_, index) => `$${index + 2}`).join(',')})
    ON CONFLICT(tenant_id) DO UPDATE SET ${columns.map(column => `${column}=EXCLUDED.${column}`).join(',')}`, [tenantId, ...Object.values(row)])
}
export async function writeAiPlatformSettings(query: AdminMenuQuery, context: AdminActorContext, input: unknown) {
  superadmin(context); await authorizeAdminActor(query, context, true)
  const body = object(input), key = nextStoredKey(body.openrouter_api_key), row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (key !== undefined) row.openrouter_api_key = key
  if (body.default_billing_mode !== undefined) { const mode = parseBillingMode(body.default_billing_mode); if (!mode) throw new AdminMenuError(400, 'Invalid billing mode'); row.default_billing_mode = mode }
  if (body.default_markup_pct !== undefined) { const markup = Number(body.default_markup_pct); if (!Number.isFinite(markup) || markup < 0 || markup > 1000) throw new AdminMenuError(400, 'Margin must be between 0 and 1000%'); row.default_markup_pct = clampMarkup(markup) }
  if (body.usd_to_brl !== undefined) { const rate = Number(body.usd_to_brl); if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new AdminMenuError(400, 'Invalid USD→BRL rate'); row.usd_to_brl = rate }
  const columns = Object.keys(row)
  await query(`INSERT INTO public.platform_ai_settings(id,${columns.join(',')}) VALUES(1,${columns.map((_, index) => `$${index + 1}`).join(',')})
    ON CONFLICT(id) DO UPDATE SET ${columns.map(column => `${column}=EXCLUDED.${column}`).join(',')}`, Object.values(row))
}
