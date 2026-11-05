import type Stripe from 'stripe'
export type BillingCycle = 'monthly' | 'annual'
export interface PlanPriceIds { stripe_price_monthly_id: string | null; stripe_price_annual_id: string | null }
export class PlanChangeError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'PlanChangeError' }
}
export const priceIdForCycle = (plan: PlanPriceIds, cycle: BillingCycle) => (cycle === 'annual' ? plan.stripe_price_annual_id : plan.stripe_price_monthly_id) || null
export const endedSubscription = (status: string) => status === 'canceled' || status === 'incomplete_expired'
export function planChangeBody(params: { subscription: { status: string; items: { data: Array<{ id: string; price: { id: string } }> } }; tenantId: string; plan: PlanPriceIds & { id: string }; cycle: BillingCycle; prorationDate?: number }): Stripe.SubscriptionUpdateParams | null {
  const price = priceIdForCycle(params.plan, params.cycle)
  if (!price) throw new PlanChangeError('That plan is not set up for billing yet. Run `npm run stripe:setup-plans`.', 503)
  const item = params.subscription.items.data[0]
  if (!item) throw new PlanChangeError('The Stripe subscription has no plan item to change.', 502)
  if (params.subscription.status === 'past_due' || params.subscription.status === 'unpaid') throw new PlanChangeError('The last payment failed. Update the payment method in the billing portal first.', 409)
  if (item.price.id === price) return null
  return { items: [{ id: item.id, price }], proration_behavior: 'create_prorations', payment_behavior: 'error_if_incomplete',
    ...(params.prorationDate === undefined ? {} : { proration_date: params.prorationDate }), metadata: { kind: 'plan', tenant_id: params.tenantId, plan_id: params.plan.id } }
}
