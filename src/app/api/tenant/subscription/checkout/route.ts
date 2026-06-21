/**
 * POST /api/tenant/subscription/checkout
 *
 * Creates a Stripe Checkout session (mode: subscription) for the tenant's SaaS
 * plan. The webhook (checkout.session.completed + customer.subscription.*) writes
 * stripe_customer_id / stripe_subscription_id / period / status back into
 * tenant_subscriptions, keyed by metadata.kind === 'plan'.
 *
 * Body: { plan_id?: string, billing_cycle?: 'monthly' | 'annual' }
 *   - plan_id defaults to the tenant's current plan (renew/restart billing).
 *   - billing_cycle defaults to 'monthly'.
 *
 * Requires the plan to have been provisioned via `npm run stripe:setup-plans`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const billingCycle: 'monthly' | 'annual' = body?.billing_cycle === 'annual' ? 'annual' : 'monthly'
  const requestedPlanId: string | undefined = typeof body?.plan_id === 'string' ? body.plan_id : undefined

  const supabase = createServiceClient()

  // Resolve target plan: explicit plan_id, else the tenant's current plan.
  const { data: sub } = await supabase
    .from('tenant_subscriptions')
    .select('plan_id, stripe_customer_id')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  const targetPlanId = requestedPlanId ?? sub?.plan_id
  if (!targetPlanId) {
    return NextResponse.json({ error: 'No plan specified and tenant has no current plan' }, { status: 400 })
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('id, stripe_price_monthly_id, stripe_price_annual_id')
    .eq('id', targetPlanId)
    .maybeSingle()

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  const priceId = billingCycle === 'annual' ? plan.stripe_price_annual_id : plan.stripe_price_monthly_id
  if (!priceId) {
    return NextResponse.json(
      { error: 'Plan not configured for billing. Run `npm run stripe:setup-plans`.' },
      { status: 503 },
    )
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
