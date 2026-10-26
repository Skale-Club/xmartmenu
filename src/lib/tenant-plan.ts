/**
 * getTenantPlan.ts - Tenant plan resolution helper
 *
 * SEED-009 Phase A: Resolves a tenant's effective plan with override support.
 * - NULL override values = use plan's base value
 * - Non-NULL override values = use overridden value
 * - Returns fully-resolved EffectivePlan object (never mixed values)
 *
 * Usage:
 *   const plan = await getTenantPlan(tenantId)
 *   if (plan.features.includes('payments')) { ... }
 *
 * All readers accept an optional Supabase client. When omitted they fall back
 * to the service-role client so feature-gating works in anonymous/server
 * contexts (public checkout, order creation) where the cookie client would be
 * blocked by RLS on tenant_subscriptions. The tenantId is always supplied by an
 * already-authorized caller, so service-role reads here are safe.
 */

import { createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EffectivePlan, Plan } from '@/types/database'
import { initialSettingsForPlan, liveFeatures, ORDERS_ONLY_SETTINGS, PAYMENTS_ONLY_SETTINGS, settingsPatchForPlan } from '@/lib/plan-settings'
import { resolveServiceCapabilities, resolveTenantCapabilities, type ServiceCapabilities, type ServiceSettings, type TenantCapabilities } from '@/lib/service-modes'

interface SubscriptionWithPlan {
  tenant_id: string
  plan_id: string
  billing_cycle: 'monthly' | 'annual'
  status: 'active' | 'cancelled' | 'trial' | 'past_due'
  override_monthly_price: number | null
  override_annual_price: number | null
  override_transaction_fee_pct: number | null
  override_notes: string | null
  // supabase-js returns a to-one embedded relation as a single object; some
  // PostgREST setups return an array. Tolerate both (see resolution below).
  plans: Plan | Plan[] | null
}

/**
 * Resolves the effective plan for a tenant, including any price/feature overrides.
 *
 * @param tenantId - The tenant UUID
 * @param client - Optional Supabase client (defaults to service-role client)
 * @returns EffectivePlan with all values fully resolved, or null if no subscription
 */
export async function getTenantPlan(
  tenantId: string,
  client?: SupabaseClient,
): Promise<EffectivePlan | null> {
  const supabase = client ?? createServiceClient()

  const { data: subscription, error } = await supabase
    .from('tenant_subscriptions')
    .select(`
      tenant_id,
      plan_id,
      billing_cycle,
      status,
      override_monthly_price,
      override_annual_price,
      override_transaction_fee_pct,
      override_notes,
      plans (
        id,
        name,
        slug,
        description,
        monthly_price,
        annual_price,
        transaction_fee_pct,
        features
      )
    `)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !subscription) {
    // No subscription found - tenant may be on legacy system or not set up
    return null
  }

  const subscriptionData = subscription as SubscriptionWithPlan
  // supabase-js returns a to-one embedded relation (plans) as a single object,
  // not an array. Some PostgREST setups return an array — handle both, otherwise
  // `plans[0]` is undefined and getTenantPlan silently returns null, which
  // disables all plan feature-gating (isStripeEnabled, payments checks, etc.).
  const planRaw = subscriptionData.plans
  const plan = Array.isArray(planRaw) ? planRaw[0] : planRaw

  if (!plan) {
    return null
  }

  // Only a live subscription grants access to paid features. A cancelled or
  // past_due tenant keeps its plan record (name/prices remain visible for the
  // billing UI and re-activation) but its features are revoked, so every gate
  // that checks `plan.features` (isStripeEnabled, tenantHasFeature, payment
  // creation, order gating) fails closed. Without this, a tenant that cancels
  // keeps taking payments and using every feature indefinitely for free.
  const isLive = subscription.status === 'active' || subscription.status === 'trial'

  // Resolve override pattern: NULL = use plan value, non-NULL = override
  const effectivePlan: EffectivePlan = {
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    description: plan.description,
    // Apply overrides: use override value if present, otherwise use plan base value
    monthly_price: subscription.override_monthly_price ?? plan.monthly_price,
    annual_price: subscription.override_annual_price ?? plan.annual_price,
    transaction_fee_pct: subscription.override_transaction_fee_pct ?? plan.transaction_fee_pct,
    features: isLive ? plan.features : [],
    billing_cycle: subscription.billing_cycle,
    status: subscription.status,
    // Check if grandfathered (has override_notes indicating grandfather status)
    is_grandfathered: subscription.override_notes?.includes('grandfathered') ?? false,
  }

  return effectivePlan
}

/**
 * Check if a tenant has a specific feature enabled
 *
 * @param tenantId - The tenant UUID
 * @param feature - Feature slug to check (e.g., 'payments', 'orders')
 * @param client - Optional Supabase client (defaults to service-role client)
 * @returns true if feature is available on tenant's plan
 */
export async function tenantHasFeature(
  tenantId: string,
  feature: string,
  client?: SupabaseClient,
): Promise<boolean> {
  const plan = await getTenantPlan(tenantId, client)
  if (!plan) return false
  return plan.features.includes(feature)
}

/**
 * Check if tenant is on a paid plan (not free)
 *
 * @param tenantId - The tenant UUID
 * @param client - Optional Supabase client (defaults to service-role client)
 * @returns true if tenant has any paid subscription
 */
export async function tenantHasPaidPlan(
  tenantId: string,
  client?: SupabaseClient,
): Promise<boolean> {
  const plan = await getTenantPlan(tenantId, client)
  if (!plan) return false
  // All seeded plans are paid (menu, orders, payments)
  return plan.monthly_price > 0 || plan.annual_price > 0
}

/**
 * What a restaurant can do with orders right now — its plan's ceiling combined
 * with its own switches (see service-modes.ts). A missing or revoked plan
 * counts as menu only.
 */
export async function getTenantServiceCapabilities(
  tenantId: string,
  settings: ServiceSettings | null | undefined,
  client?: SupabaseClient,
): Promise<ServiceCapabilities> {
  const plan = await getTenantPlan(tenantId, client).catch(() => null)
  return resolveServiceCapabilities(plan?.features ?? null, settings)
}

const CAPABILITY_SETTINGS_COLUMNS = [
  'orders_enabled', 'direct_orders_enabled', 'table_management_enabled',
  'whatsapp_orders_enabled', 'whatsapp', 'tips_enabled', 'item_notes_enabled',
  'ingredient_customization_enabled', 'dine_in_enabled', 'pickup_enabled',
  'delivery_enabled', 'upsell_enabled',
].join(', ')

/**
 * The one object every screen and route reads (service-modes.ts
 * resolveTenantCapabilities): plan ceiling + the restaurant's switches.
 * Pass `settings` when the caller already loaded tenant_settings; otherwise
 * the columns the resolver needs are read with the service client.
 */
export async function getTenantCapabilities(
  tenantId: string,
  settings?: ServiceSettings | null,
  client?: SupabaseClient,
): Promise<TenantCapabilities> {
  const supabase = client ?? createServiceClient()
  const [plan, resolvedSettings] = await Promise.all([
    getTenantPlan(tenantId, supabase).catch(() => null),
    settings !== undefined
      ? Promise.resolve(settings)
      : supabase.from('tenant_settings').select(CAPABILITY_SETTINGS_COLUMNS).eq('tenant_id', tenantId).maybeSingle().then(r => (r.data ?? null) as ServiceSettings | null),
  ])
  return resolveTenantCapabilities(plan?.features ?? null, resolvedSettings)
}

// ---------------------------------------------------------------------------
// Plan ↔ settings reconciliation
//
// A plan only sets the ceiling; the restaurant's own switches live in
// tenant_settings. When the ceiling drops (downgrade, cancellation, dunning)
// the switches that sit above it must go off with it, otherwise the admin
// panel keeps showing a mode as "on" that no route will honour. Data that
// belongs to a higher plan (stripe_connections, restaurant_tables) is never
// touched, so a re-upgrade picks up where the restaurant left off.
// The pure parts (what to switch off, what a new tenant starts with) live in
// plan-settings.ts so they can be unit-tested without a database.
// ---------------------------------------------------------------------------

export { settingsPatchForPlan, initialSettingsForPlan, liveFeatures, PAYMENTS_ONLY_SETTINGS, ORDERS_ONLY_SETTINGS }

/**
 * Switches off whatever in tenant_settings exceeds `features` (pass the LIVE
 * features: [] for a cancelled or past-due subscription). Service-role client
 * expected — callers are webhooks and superadmin routes. Never throws; the
 * caller decides whether a failure should fail its request.
 */
export async function reconcileSettingsWithPlan(
  tenantId: string,
  features: readonly string[] | null | undefined,
  client?: SupabaseClient,
): Promise<{ ok: boolean; patch: Record<string, false>; error?: string }> {
  const patch = settingsPatchForPlan(features)
  if (Object.keys(patch).length === 0) return { ok: true, patch }
  const supabase = client ?? createServiceClient()
  const { error } = await supabase.from('tenant_settings').update(patch).eq('tenant_id', tenantId)
  if (error) return { ok: false, patch, error: error.message }
  return { ok: true, patch }
}

/**
 * Reads the tenant's current subscription (plan + status, with the same
 * live-only rule as getTenantPlan) and reconciles its settings with it.
 * Call after any write to tenant_subscriptions that can change the plan or status.
 */
export async function reconcileTenantSettings(
  tenantId: string,
  client?: SupabaseClient,
): Promise<{ ok: boolean; patch: Record<string, false>; error?: string }> {
  const supabase = client ?? createServiceClient()
  // Read the row directly (not getTenantPlan): a failed read must NOT look like
  // "no plan" and switch a paying restaurant's features off.
  const { data, error } = await supabase
    .from('tenant_subscriptions')
    .select('status, plans(features)')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) return { ok: false, patch: {}, error: error.message }
  // No subscription at all counts as menu only, like everywhere else.
  const planRaw = (data as { plans?: { features: string[] } | { features: string[] }[] | null } | null)?.plans
  const plan = Array.isArray(planRaw) ? planRaw[0] : planRaw
  return reconcileSettingsWithPlan(tenantId, liveFeatures(data?.status, plan?.features), supabase)
}
