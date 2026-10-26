/**
 * plan-billing.ts - changing a tenant's SaaS plan on an existing Stripe subscription.
 *
 * A tenant that already pays (tenant_subscriptions.stripe_subscription_id) must
 * never get a second Checkout: the old subscription would keep billing in
 * parallel. Plan and billing-cycle changes instead swap the price on the
 * existing subscription item, prorated. The Stripe webhook
 * (customer.subscription.updated) then mirrors the new price into
 * tenant_subscriptions (plan_id + billing_cycle) and reconciles the tenant's
 * switches with the new ceiling, so the database follows Stripe, never the
 * other way round. Used by the tenant checkout/PATCH routes and the superadmin
 * plan-assignment route.
 */
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { log } from '@/lib/observability/log'

export type BillingCycle = 'monthly' | 'annual'

export interface PlanPriceIds {
  stripe_price_monthly_id: string | null
  stripe_price_annual_id: string | null
}

/** Pure: the Stripe price a plan bills for a cycle, or null while it is not provisioned. */
export function priceIdForCycle(plan: PlanPriceIds, cycle: BillingCycle): string | null {
  return (cycle === 'annual' ? plan.stripe_price_annual_id : plan.stripe_price_monthly_id) || null
}

/** Stripe statuses that no longer bill: a new Checkout is safe once the subscription is one of these. */
const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired'])
/** Stripe statuses where a price swap would try to charge a card that is already failing. */
const DUNNING_STATUSES = new Set(['past_due', 'unpaid'])

/** An error with the HTTP status a route should answer with. */
export class PlanChangeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'PlanChangeError'
  }
}

/**
 * The Stripe subscription when it still bills, null when it ended or no longer
 * exists (a stale stripe_subscription_id left on a cancelled tenant).
 */
export async function getLiveStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    return ENDED_STATUSES.has(subscription.status) ? null : subscription
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'resource_missing') return null
    throw error
  }
}

/**
 * Swaps the price of a live plan subscription to `plan`/`cycle`, prorated.
 * Returns false when it already bills that price (nothing to do). Throws
 * PlanChangeError for anything the caller should show to the user.
 */
export async function swapStripeSubscriptionPlan(params: {
  subscription: Stripe.Subscription
  tenantId: string
  plan: PlanPriceIds & { id: string }
  cycle: BillingCycle
}): Promise<boolean> {
  const { subscription, tenantId, plan, cycle } = params
  const priceId = priceIdForCycle(plan, cycle)
  if (!priceId) {
    throw new PlanChangeError('That plan is not set up for billing yet. Run `npm run stripe:setup-plans`.', 503)
  }
  const item = subscription.items.data[0]
  if (!item) throw new PlanChangeError('The Stripe subscription has no plan item to change.', 502)
  // Checked first: a dunning subscription must go to the billing portal even
  // when the request is a no-op ("reactivate" on the plan it is already on).
  if (DUNNING_STATUSES.has(subscription.status)) {
    throw new PlanChangeError('The last payment failed. Update the payment method in the billing portal first.', 409)
  }
  if (item.price.id === priceId) return false

  try {
    await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
      // A swap that cannot be charged must fail outright, not leave the
      // subscription half-changed with an unpaid invoice.
      payment_behavior: 'error_if_incomplete',
      metadata: { kind: 'plan', tenant_id: tenantId, plan_id: plan.id },
    })
  } catch (error) {
    log.error('plan_billing.swap_failed', { err: error, tenant_id: tenantId, subscription: subscription.id })
    const stripeError = error as { type?: string; message?: string }
    if (stripeError?.type === 'StripeCardError') {
      throw new PlanChangeError(stripeError.message ?? 'The card was declined. Update it in the billing portal and try again.', 402)
    }
    throw new PlanChangeError('Stripe could not change the plan. Try again in a moment.', 502)
  }
  return true
}
