import { AdminMenuError } from '../data/admin-menus'
import type { AdminActorContext } from '../data/admin-actor'
import { assertOwnedAiActor, readOwnedAiBillingAvailability, readOwnedAiPanelTenants } from '../data/ai-panel-runtime'
import { loadPlatformAiSettings, loadTenantAiSettings } from './access'
import { maskedOrEmpty, startOfMonthIso, unbilledChargeUsd, usageByTenant } from './settings-service'
import { parseBillingMode } from './billing-rules'

export async function nativeAiTenantPayload(context: AdminActorContext, superadminView: boolean) {
  if (!context.tenantId || (superadminView && context.role !== 'superadmin')) throw new AdminMenuError(403, 'Forbidden')
  await assertOwnedAiActor(context)
  const [platform, tenant, usage, unbilled, canBill] = await Promise.all([
    loadPlatformAiSettings(), loadTenantAiSettings(context.tenantId), usageByTenant(startOfMonthIso(), context.tenantId),
    superadminView ? unbilledChargeUsd(context.tenantId) : Promise.resolve(0),
    superadminView ? readOwnedAiBillingAvailability(context) : Promise.resolve(false),
  ])
  const month = usage.get(context.tenantId) ?? null
  if (!superadminView) return { effective_mode: tenant.mode ?? platform.defaultMode, openrouter_api_key: maskedOrEmpty(tenant.key),
    last_key_error: tenant.lastKeyError, last_key_error_at: tenant.lastKeyErrorAt, usd_to_brl: platform.usdToBrl,
    month: month && { calls: month.calls, charge_usd: month.chargeUsd, calls_on_own_key: month.byKey.tenant } }
  return { billing_mode: tenant.mode, effective_mode: tenant.mode ?? platform.defaultMode, openrouter_api_key: maskedOrEmpty(tenant.key),
    markup_pct: tenant.markupPct, effective_markup_pct: tenant.markupPct ?? platform.defaultMarkupPct,
    last_key_error: tenant.lastKeyError, last_key_error_at: tenant.lastKeyErrorAt, global_key_configured: platform.platformKeySource !== 'none',
    usd_to_brl: platform.usdToBrl, month, unbilled_charge_usd: unbilled, can_bill: canBill }
}
export async function nativeAiGlobalPayload(context: AdminActorContext) {
  const [platform, tenants, usage] = await Promise.all([loadPlatformAiSettings(), readOwnedAiPanelTenants(context), usageByTenant(startOfMonthIso())])
  return { settings: { openrouter_api_key: maskedOrEmpty(platform.platformKeySource === 'panel' ? platform.platformKey : null), key_source: platform.platformKeySource,
    default_billing_mode: platform.defaultMode, default_markup_pct: platform.defaultMarkupPct, usd_to_brl: platform.usdToBrl },
  platform_usage: usage.get(null) ?? null, tenants: tenants.map(row => ({ id: row.id, name: row.name, slug: row.slug,
    billing_mode: parseBillingMode(row.billing_mode), effective_mode: parseBillingMode(row.billing_mode) ?? platform.defaultMode,
    has_key: row.has_key === true, markup_pct: row.markup_pct == null ? null : Number(row.markup_pct), last_key_error: row.last_key_error ?? null,
    last_key_error_at: row.last_key_error_at ?? null, month: usage.get(String(row.id)) ?? null })) }
}
