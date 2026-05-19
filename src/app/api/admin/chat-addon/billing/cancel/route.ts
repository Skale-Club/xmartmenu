/**
 * POST /api/admin/chat-addon/billing/cancel
 *
 * Cancels the AI Chat Addon Stripe subscription at the end of the current
 * billing period. The chat_addon_active flag stays true until the webhook
 * fires on the actual cancellation.
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
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 })
  }

  // Find the addon subscription on this customer
  const subs = await stripe.subscriptions.list({
    customer: sub.stripe_customer_id,
    status: 'active',
    limit: 20,
  })
  const addonSub = subs.data.find((s) => s.metadata?.addon === 'chat')
  if (!addonSub) return NextResponse.json({ error: 'Addon subscription not found' }, { status: 404 })

  await stripe.subscriptions.update(addonSub.id, { cancel_at_period_end: true })
  return NextResponse.json({ ok: true })
}
