/**
 * POST /api/tenant/subscription/checkout
 *
 * Starts, changes or restarts the tenant's SaaS plan billing. Owner / superadmin
 * only (store-staff get 403).
 *
 * Body: { plan_id?: string, billing_cycle?: 'monthly' | 'annual' }
 *   - plan_id must be an ACTIVE plan; it defaults to the tenant's current plan
 *     (renew / reactivate).
 *   - billing_cycle defaults to 'monthly'.
 *
 * Two outcomes:
 *   1. No live Stripe subscription (never subscribed, or it ended): creates a
 *      Stripe Checkout session (mode: subscription) and answers { url }. The
 *      webhook (checkout.session.completed + customer.subscription.*) writes
 *      plan / customer / subscription / period / status back, keyed by
 *      metadata.kind === 'plan'.
 *   2. A live Stripe subscription: NEVER a second Checkout (it would bill in
 *      parallel). The price on the existing subscription is swapped, prorated,
 *      and the answer is { updated: true, plan_id, billing_cycle }; the
 *      customer.subscription.updated webhook then mirrors the plan into
 *      tenant_subscriptions and reconciles the restaurant's switches.
 *
 * Requires the plans to have been provisioned via `npm run stripe:setup-plans`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'
import {
  getLiveStripeSubscription,
  PlanChangeError,
  priceIdForCycle,
  swapStripeSubscriptionPlan,
} from '@/lib/plan-billing'

async function handlePOST(request: NextRequest) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const billingCycle: 'monthly' | 'annual' = body?.billing_cycle === 'annual' ? 'annual' : 'monthly'
  const requestedPlanId: string | undefined = typeof body?.plan_id === 'string' && body.plan_id ? body.plan_id : undefined

  const supabase = createServiceClient()

  const { data: sub } = await supabase
    .from('tenant_subscriptions')
    .select('plan_id, stripe_customer_id, stripe_subscription_id, status')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  // Resolve target plan: explicit plan_id (must be active), else the tenant's current plan.
  const targetPlanId = requestedPlanId ?? sub?.plan_id
  if (!targetPlanId) {
    return NextResponse.json({ error: 'No plan specified and tenant has no current plan' }, { status: 400 })
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('id, is_active, stripe_price_monthly_id, stripe_price_annual_id')
    .eq('id', targetPlanId)
    .maybeSingle()

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  if (requestedPlanId && !plan.is_active) {
    return NextResponse.json({ error: 'That plan is no longer available.' }, { status: 400 })
  }

  const priceId = priceIdForCycle(plan, billingCycle)
  if (!priceId) {
    return NextResponse.json(
      { error: 'Plan not configured for billing. Run `npm run stripe:setup-plans`.' },
      { status: 503 },
    )
  }

  // A tenant that already has a billing Stripe subscription changes plan on it.
  if (sub?.stripe_subscription_id) {
    let liveSubscription
    try {
      liveSubscription = await getLiveStripeSubscription(sub.stripe_subscription_id)
    } catch (error) {
      log.error('tenant.checkout.stripe_lookup_failed', { err: error, tenant_id: effective.tenantId })
      return NextResponse.json({ error: 'Could not reach Stripe. Try again in a moment.' }, { status: 502 })
    }

    if (liveSubscription) {
      let changed: boolean
      try {
        changed = await swapStripeSubscriptionPlan({ subscription: liveSubscription, tenantId: effective.tenantId, plan, cycle: billingCycle })
      } catch (error) {
        if (error instanceof PlanChangeError) {
          return NextResponse.json({ error: error.message, portal: error.status === 409 }, { status: error.status })
        }
        throw error
      }
      // changed = false: the subscription already bills exactly that price.
      return NextResponse.json({ updated: true, changed, plan_id: plan.id, billing_cycle: billingCycle })
    }
    // Ended subscription: fall through to a fresh Checkout (same Stripe customer).
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const metadata = { kind: 'plan', tenant_id: effective.tenantId, plan_id: targetPlanId }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer: sub?.stripe_customer_id ?? undefined,
    metadata,
    subscription_data: { metadata },
    success_url: `${baseUrl}/settings/subscription?plan=success`,
    cancel_url: `${baseUrl}/settings/subscription?plan=cancelled`,
  })

  return NextResponse.json({ url: session.url })
}

export const POST = withApi('POST /api/tenant/subscription/checkout', handlePOST)
