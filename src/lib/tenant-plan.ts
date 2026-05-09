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
 */

import { createClient } from '@/lib/supabase/server'
import type { EffectivePlan, Plan } from '@/types/database'

interface SubscriptionWithPlan {
  tenant_id: string
  plan_id: string
  billing_cycle: 'monthly' | 'annual'
  status: 'active' | 'cancelled' | 'trial' | 'past_due'
  override_monthly_price: number | null
  override_annual_price: number | null
  override_transaction_fee_pct: number | null
  override_notes: string | null
  plans: Plan[]  // Supabase returns joined relations as arrays
}

/**
 * Resolves the effective plan for a tenant, including any price/feature overrides.
 * 
 * @param tenantId - The tenant UUID
 * @returns EffectivePlan with all values fully resolved, or null if no subscription
 */
export async function getTenantPlan(tenantId: string): Promise<EffectivePlan | null> {
  const supabase = await createClient()
  
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
  const plan = subscriptionData.plans[0]

  if (!plan) {
    return null
  }

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
    features: plan.features,
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
 * @returns true if feature is available on tenant's plan
 */
export async function tenantHasFeature(tenantId: string, feature: string): Promise<boolean> {
  const plan = await getTenantPlan(tenantId)
  if (!plan) return false
  return plan.features.includes(feature)
}

/**
 * Check if tenant is on a paid plan (not free)
 * 
 * @param tenantId - The tenant UUID
 * @returns true if tenant has any paid subscription
 */
export async function tenantHasPaidPlan(tenantId: string): Promise<boolean> {
  const plan = await getTenantPlan(tenantId)
  if (!plan) return false
  // All seeded plans are paid (menu, orders, payments)
  return plan.monthly_price > 0 || plan.annual_price > 0
}