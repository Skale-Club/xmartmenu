/**
 * GET/POST /api/admin/chat-addon/billing/checkout
 *
 * Creates a Stripe Checkout session for the AI Chat Addon ($20/month). The
 * tenant_id is encoded in the session metadata so the webhook can flip
 * tenant_subscriptions.chat_addon_active on success.
 *
 * Required env:
 *   STRIPE_CHAT_ADDON_PRICE_ID — the Stripe Price ID for the $20/month addon
 *   NEXT_PUBLIC_APP_URL        — used to build success/cancel URLs
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'

async function createSession() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const priceId = process.env.STRIPE_CHAT_ADDON_PRICE_ID
  if (!priceId) {
    return NextResponse.json({ error: 'Addon price not configured' }, { status: 503 })
  }

  const supabase = createServiceClient()
  const { data: sub } = await supabase
    .from('tenant_subscriptions')
    .select('stripe_customer_id')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer: sub?.stripe_customer_id ?? undefined,
    metadata: {
      tenant_id: effective.tenantId,
      addon: 'chat',
    },
    subscription_data: {
      metadata: {
        tenant_id: effective.tenantId,
        addon: 'chat',
      },
    },
    success_url: `${baseUrl}/settings/chat?addon=success`,
    cancel_url: `${baseUrl}/settings/chat?addon=cancelled`,
  })

  return NextResponse.json({ url: session.url })
}

export async function POST() {
  const r = await createSession()
  return r
}

export async function GET() {
  // Convenience: redirect directly to the Checkout URL so the admin can link
  // <a href="/api/admin/chat-addon/billing/checkout"> in the upgrade banner.
  const r = await createSession()
  if (!(r instanceof Response)) return r
  const data = await r.json().catch(() => null)
  if (data?.url) return NextResponse.redirect(data.url, { status: 303 })
  return r
}
