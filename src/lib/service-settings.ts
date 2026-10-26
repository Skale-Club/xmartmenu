/**
 * The restaurant's service switches (tenant_settings) and the plan each one
 * needs. PATCH /api/admin/service-settings is the one place the admin panel
 * saves them; the MCP tools check the same lists.
 *
 * Pure: callers load the capabilities (getTenantCapabilities / getTenantPlan)
 * and the current row.
 */
import type { PlanCeiling } from '@/lib/service-modes'

export const SERVICE_BOOLEAN_KEYS = [
  'orders_enabled',
  'direct_orders_enabled',
  'whatsapp_orders_enabled',
  'table_management_enabled',
  'tips_enabled',
  'item_notes_enabled',
  'ingredient_customization_enabled',
  'dine_in_enabled',
  'pickup_enabled',
  'delivery_enabled',
  'upsell_enabled',
] as const

export const SERVICE_NUMBER_KEYS = [
  'delivery_fee_cents',
  'pickup_eta_minutes',
  'amber_threshold_minutes',
  'red_threshold_minutes',
] as const

export const SERVICE_SETTINGS_KEYS = [...SERVICE_BOOLEAN_KEYS, 'whatsapp', ...SERVICE_NUMBER_KEYS] as const

export type ServiceBooleanKey = typeof SERVICE_BOOLEAN_KEYS[number]
export type ServiceNumberKey = typeof SERVICE_NUMBER_KEYS[number]
export type ServiceSettingsKey = typeof SERVICE_SETTINGS_KEYS[number]

export type ServiceSettingsPatch = Partial<
  Record<ServiceBooleanKey, boolean> & Record<ServiceNumberKey, number> & { whatsapp: string | null }
>

/** Keys that only mean something on the Menu + Payments plan (guest ordering). */
export const PAYMENTS_PLAN_KEYS: readonly ServiceSettingsKey[] = [
  'direct_orders_enabled', 'tips_enabled', 'dine_in_enabled', 'pickup_enabled',
  'delivery_enabled', 'delivery_fee_cents', 'pickup_eta_minutes', 'upsell_enabled',
]

/** Keys that need at least the Menu + Orders plan (staff ordering, KDS). */
export const ORDERS_PLAN_KEYS: readonly ServiceSettingsKey[] = [
  'table_management_enabled', 'item_notes_enabled', 'ingredient_customization_enabled',
  'amber_threshold_minutes', 'red_threshold_minutes',
]

/** The plan ceiling a key needs, or null when every plan has it. */
export function planRequirementFor(key: string): keyof Pick<PlanCeiling, 'orders' | 'payments'> | null {
  if ((PAYMENTS_PLAN_KEYS as readonly string[]).includes(key)) return 'payments'
  if ((ORDERS_PLAN_KEYS as readonly string[]).includes(key)) return 'orders'
  return null
}

/**
 * Keys in `values` that switch on (truthy value) something `plan` doesn't
 * include. Switching a locked key off (false / 0) is always allowed, so a
 * restaurant that downgraded can still clean up. Values equal to `current`
 * are no-ops and never locked.
 */
export function lockedServiceKeys(
  values: Record<string, unknown>,
  plan: Pick<PlanCeiling, 'orders' | 'payments'>,
  current?: Record<string, unknown> | null,
): string[] {
  const locked: string[] = []
  for (const [key, value] of Object.entries(values)) {
    const needs = planRequirementFor(key)
    if (!needs || plan[needs]) continue
    if (!value) continue
    if (current && current[key] === value) continue
    locked.push(key)
  }
  return locked
}

/** Max digits in an international phone number (E.164). */
const MAX_PHONE_DIGITS = 15

/**
 * WhatsApp number as wa.me expects it: digits only, country code first.
 * '' / null → null. Returns undefined when the value is not a usable number.
 */
export function normalizeWhatsapp(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length > MAX_PHONE_DIGITS) return undefined
  return digits
}

const NUMBER_BOUNDS: Record<ServiceNumberKey, { min: number; max: number }> = {
  delivery_fee_cents: { min: 0, max: 1_000_000 },
  pickup_eta_minutes: { min: 0, max: 1_440 },
  amber_threshold_minutes: { min: 1, max: 180 },
  red_threshold_minutes: { min: 1, max: 180 },
}

export interface ServiceSettingsValidation {
  /** Valid values to write (includes locked keys being switched off). */
  patch: ServiceSettingsPatch
  /** Keys the plan doesn't include that the body tried to switch on. */
  locked: string[]
  /** Human-readable validation errors. */
  errors: string[]
}

/**
 * Validates a PATCH body for the service switches. Unknown keys are ignored.
 * `current` (the tenant's row) lets a single threshold be checked against the
 * other one and makes unchanged locked values no-ops.
 */
export function validateServiceSettingsPatch(
  body: unknown,
  capabilities: { plan: Pick<PlanCeiling, 'orders' | 'payments'> },
  current?: Record<string, unknown> | null,
): ServiceSettingsValidation {
  const patch: ServiceSettingsPatch = {}
  const errors: string[] = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { patch, locked: [], errors: ['Invalid body'] }
  }
  const input = body as Record<string, unknown>

  for (const key of SERVICE_BOOLEAN_KEYS) {
    if (!(key in input)) continue
    const value = input[key]
    if (typeof value !== 'boolean') {
      errors.push(`${key} must be true or false`)
      continue
    }
    patch[key] = value
  }

  if ('whatsapp' in input) {
    const whatsapp = normalizeWhatsapp(input.whatsapp)
    if (whatsapp === undefined) errors.push('whatsapp must be a phone number with country code')
    else patch.whatsapp = whatsapp
  }

  for (const key of SERVICE_NUMBER_KEYS) {
    if (!(key in input)) continue
    const value = input[key]
    const { min, max } = NUMBER_BOUNDS[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      errors.push(`${key} must be a whole number from ${min} to ${max}`)
      continue
    }
    patch[key] = value
  }

  const amber = patch.amber_threshold_minutes ?? numberOrNull(current?.amber_threshold_minutes)
  const red = patch.red_threshold_minutes ?? numberOrNull(current?.red_threshold_minutes)
  const thresholdChanged = patch.amber_threshold_minutes !== undefined || patch.red_threshold_minutes !== undefined
  if (thresholdChanged && amber !== null && red !== null && amber >= red) {
    errors.push('amber_threshold_minutes must be lower than red_threshold_minutes')
  }

  const locked = lockedServiceKeys(patch, capabilities.plan, current)
  return { patch, locked, errors }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
