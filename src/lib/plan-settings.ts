/**
 * plan-settings.ts - what tenant_settings may hold for a given plan (pure).
 *
 * A plan only sets the ceiling (service-modes.ts planCeiling); the restaurant's
 * own switches live in tenant_settings. These helpers say which switches must
 * be off when the ceiling is lower than the switches, and what a brand-new
 * restaurant on a plan starts with. The DB-facing wrapper is
 * reconcileSettingsWithPlan in tenant-plan.ts.
 */
import { planCeiling } from '@/lib/service-modes'
import { ORDERS_PLAN_KEYS, PAYMENTS_PLAN_KEYS } from '@/lib/service-settings'

/**
 * The switches (boolean keys only) that a downgrade must turn off, derived
 * from the same requirement map the service-settings route enforces on save
 * (src/lib/service-settings.ts), so the two can never disagree. Numbers
 * (fees, ETAs, KDS thresholds) stay: they are harmless without the mode.
 */
const KEEP_ON_DOWNGRADE = new Set(['dine_in_enabled', 'pickup_enabled'])
// dine-in and pickup stay as they are: harmless without guest ordering, and a
// re-upgrade would otherwise land with no order type switched on.
const isSwitch = (key: string) => key.endsWith('_enabled') && !KEEP_ON_DOWNGRADE.has(key)
/** Switches that only mean something with guest ordering (the payments ceiling). */
export const PAYMENTS_ONLY_SETTINGS: readonly string[] = PAYMENTS_PLAN_KEYS.filter(isSwitch)
/** Switches that only mean something with staff ordering (the orders ceiling). */
export const ORDERS_ONLY_SETTINGS: readonly string[] = ORDERS_PLAN_KEYS.filter(isSwitch)

/** The features a subscription really grants: only a live one (active or trial) grants any. */
export function liveFeatures(status: string | null | undefined, features: readonly string[] | null | undefined): string[] {
  return status === 'active' || status === 'trial' ? [...(features ?? [])] : []
}

/**
 * Pure: the tenant_settings columns to switch off so they never exceed what
 * `features` allow. Empty when nothing is above the ceiling. dine_in and
 * pickup stay as they are — they are harmless without guest ordering.
 */
export function settingsPatchForPlan(features: readonly string[] | null | undefined): Record<string, false> {
  const ceiling = planCeiling(features)
  const patch: Record<string, false> = {}
  if (!ceiling.payments) for (const key of PAYMENTS_ONLY_SETTINGS) patch[key] = false
  if (!ceiling.orders) for (const key of ORDERS_ONLY_SETTINGS) patch[key] = false
  return patch
}

/**
 * Pure: the tenant_settings a brand-new restaurant starts with on a plan, so a
 * paid tenant begins in the mode it paid for. Orders are on from day one; the
 * mode switches follow the ceiling.
 */
export function initialSettingsForPlan(features: readonly string[] | null | undefined): Record<string, boolean> {
  const ceiling = planCeiling(features)
  const settings: Record<string, boolean> = { orders_enabled: true }
  if (ceiling.payments) {
    settings.direct_orders_enabled = true
    settings.dine_in_enabled = true
  }
  if (ceiling.orders) settings.table_management_enabled = true
  return settings
}
