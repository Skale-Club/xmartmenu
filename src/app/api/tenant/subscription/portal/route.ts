/**
 * POST /api/tenant/subscription/portal
 *
 * Opens the Stripe Billing Portal for the tenant's customer so they can change
 * plan, update the payment method, or cancel. Returns { url } to redirect to.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = createServiceClient()
  const { data: sub } = await supabase
    .from('tenant_subscriptions')
    .select('stripe_customer_id')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'No active billing customer. Subscribe first.' }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${baseUrl}/settings/subscription`,
  })

  return NextResponse.json({ url: session.url })
}
