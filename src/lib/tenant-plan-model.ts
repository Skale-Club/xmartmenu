import type { EffectivePlan, Plan } from '@/types/database'

export interface PlanSubscriptionFacts {
  billing_cycle: 'monthly' | 'annual'; status: 'active' | 'cancelled' | 'trial' | 'past_due'
  override_monthly_price: number | null; override_annual_price: number | null; override_transaction_fee_pct: number | null; override_notes: string | null
}
export type PlanFacts = Pick<Plan, 'id' | 'name' | 'slug' | 'description' | 'monthly_price' | 'annual_price' | 'transaction_fee_pct' | 'features'>
/** Shared legacy/native override and live-feature semantics. Zero is explicit. */
export function resolveEffectivePlan(plan: PlanFacts | null, subscription: PlanSubscriptionFacts): EffectivePlan | null {
  if (!plan) return null
  return { id: plan.id, name: plan.name, slug: plan.slug, description: plan.description,
    monthly_price: subscription.override_monthly_price ?? plan.monthly_price, annual_price: subscription.override_annual_price ?? plan.annual_price,
    transaction_fee_pct: subscription.override_transaction_fee_pct ?? plan.transaction_fee_pct,
    features: subscription.status === 'active' || subscription.status === 'trial' ? plan.features : [],
    billing_cycle: subscription.billing_cycle, status: subscription.status, is_grandfathered: subscription.override_notes?.includes('grandfathered') ?? false }
}
