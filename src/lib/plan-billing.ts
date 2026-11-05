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
import { endedSubscription, planChangeBody, PlanChangeError, type BillingCycle, type PlanPriceIds } from './billing/plan-change-model'
export { PlanChangeError, priceIdForCycle } from './billing/plan-change-model'
export type { BillingCycle, PlanPriceIds } from './billing/plan-change-model'

/**
 * The Stripe subscription when it still bills, null when it ended or no longer
 * exists (a stale stripe_subscription_id left on a cancelled tenant).
 */
export async function getLiveStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    return endedSubscription(subscription.status) ? null : subscription
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
  const { subscription, tenantId } = params
  const body = planChangeBody(params)
  if (!body) return false

  try {
    await stripe.subscriptions.update(subscription.id, body)
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
