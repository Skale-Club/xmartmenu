import type { EffectivePlan } from '@/types/database'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { resolveEffectivePlan, type PlanSubscriptionFacts } from '../tenant-plan-model'
import { resolveTenantCapabilities, type ServiceSettings } from '../service-modes'
import { settingsPatchForPlan } from '../plan-settings'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SETTINGS = 'orders_enabled,direct_orders_enabled,table_management_enabled,whatsapp_orders_enabled,whatsapp,tips_enabled,item_notes_enabled,ingredient_customization_enabled,dine_in_enabled,pickup_enabled,delivery_enabled,upsell_enabled'
function numeric(value: unknown): number { const number = Number(value); if (value === null || value === undefined || !Number.isFinite(number)) throw new AdminMenuError(503, 'Plan information is unavailable'); return number }
const nullableNumeric = (value: unknown) => value === null || value === undefined ? null : numeric(value)

export async function readNativeTenantPlan(query: AdminMenuQuery, tenantId: string, lock = false): Promise<EffectivePlan | null> {
  if (!UUID.test(tenantId)) return null
  const result = await query(`SELECT p.id,p.name,p.slug,p.description,p.monthly_price,p.annual_price,p.transaction_fee_pct,p.features,
    s.billing_cycle,s.status,s.override_monthly_price,s.override_annual_price,s.override_transaction_fee_pct,s.override_notes
    FROM public.tenant_subscriptions s JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2${lock ? ' FOR SHARE OF s,p' : ''}`, [tenantId])
  if (result.rows.length > 1) throw new AdminMenuError(503, 'Plan information is unavailable')
  const row = result.rows[0]
  if (!row) return null
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.slug !== 'string' || !Array.isArray(row.features) || row.features.some(value => typeof value !== 'string')
    || !['active', 'cancelled', 'trial', 'past_due'].includes(String(row.status)) || !['monthly', 'annual'].includes(String(row.billing_cycle))) throw new AdminMenuError(503, 'Plan information is unavailable')
  return resolveEffectivePlan({ id: row.id, name: row.name, slug: row.slug, description: typeof row.description === 'string' ? row.description : null,
    monthly_price: numeric(row.monthly_price), annual_price: numeric(row.annual_price), transaction_fee_pct: numeric(row.transaction_fee_pct), features: row.features },
  { billing_cycle: row.billing_cycle, status: row.status, override_monthly_price: nullableNumeric(row.override_monthly_price), override_annual_price: nullableNumeric(row.override_annual_price),
    override_transaction_fee_pct: nullableNumeric(row.override_transaction_fee_pct), override_notes: typeof row.override_notes === 'string' ? row.override_notes : null } as PlanSubscriptionFacts)
}
export async function readNativeTenantCapabilities(query: AdminMenuQuery, tenantId: string, supplied?: ServiceSettings | null) {
  const plan = await readNativeTenantPlan(query, tenantId)
  let settings = supplied
  if (settings === undefined) {
    if (!UUID.test(tenantId)) return resolveTenantCapabilities(plan?.features ?? null, null)
    const result = await query(`SELECT ${SETTINGS} FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 2`, [tenantId])
    if (result.rows.length > 1) throw new AdminMenuError(503, 'Service settings are unavailable')
    settings = result.rows[0] as ServiceSettings | undefined
  }
  return resolveTenantCapabilities(plan?.features ?? null, settings)
}
async function tenantLock(query: AdminMenuQuery, tenantId: string) {
  if (!UUID.test(tenantId)) throw new AdminMenuError(400, 'Invalid tenant')
  await query('SELECT id FROM public.tenants WHERE id=$1 FOR UPDATE', [tenantId])
}
async function applyPatch(query: AdminMenuQuery, tenantId: string, features: readonly string[] | null | undefined) {
  const patch = settingsPatchForPlan(features), keys = Object.keys(patch)
  if (keys.length) await query(`UPDATE public.tenant_settings SET ${keys.map(key => `${key}=false`).join(',')} WHERE tenant_id=$1`, [tenantId])
  return { ok: true, patch }
}
/** Existing trusted server callers may reconcile an explicitly chosen ceiling. */
export async function reconcileNativeSettings(query: AdminMenuQuery, tenantId: string, features: readonly string[] | null | undefined) {
  await tenantLock(query, tenantId)
  return applyPatch(query, tenantId, features)
}
/** Can be composed inside a future native lifecycle-webhook transaction. */
export async function reconcileNativeTenantPlan(query: AdminMenuQuery, tenantId: string) {
  await tenantLock(query, tenantId)
  const plan = await readNativeTenantPlan(query, tenantId, true)
  return applyPatch(query, tenantId, plan?.features)
}
