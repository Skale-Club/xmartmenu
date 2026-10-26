/**
 * POST /api/stripe/payment-intents
 * 
 * Create a PaymentIntent for an order.
 * Requires authenticated session and valid pending order.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreatePaymentIntent, isStripeEnabled } from '@/lib/stripe'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

async function handlePOST(request: NextRequest) {
  try {
    const rl = await rateLimit('payment-intents', getClientIp(request), 12, '1 m')
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

    const supabase = await createClient()
    
    // 1. Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Get request body
    const body = await request.json()
    const { order_id } = body as { order_id: string }

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 })
    }

    // 3. Fetch order. `total` is NUMERIC dollars in DB; converted to cents
    // for Stripe via Math.round below.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, tenant_id, status, total, tip_cents, payment_intent_id')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // 4. Only an unpaid order can be paid. Guest orders that need online
    // payment are created as awaiting_payment; 'pending' covers orders placed
    // before Stripe was connected.
    if (order.status !== 'awaiting_payment' && order.status !== 'pending') {
      return NextResponse.json({ error: 'Order is not awaiting payment' }, { status: 400 })
    }

    // 4b. P1-02 fix: if the order already has a payment_intent_id, only
    // re-issue when the same authenticated user holds an admin/staff role
    // on the order's tenant. Anonymous callers (the QR-customer flow)
    // would just hit the existing intent, but we still want to prevent
    // griefing by a random authenticated tenant trying to wrap somebody
    // else's order. The simplest defensible check: require either no
    // existing intent yet, OR caller's profile.tenant_id matches the order.
    if (order.payment_intent_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, role')
        .eq('id', user.id)
        .single()
      const sameTenant = profile?.tenant_id === order.tenant_id
      const isSuperadmin = profile?.role === 'superadmin' || profile?.role === 'super-admin'
      if (!sameTenant && !isSuperadmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // 5. Check the plan includes guest payments and Stripe Connect (only the
    // plan matters here).
    const capabilities = await getTenantCapabilities(order.tenant_id, null)
    if (!capabilities.plan.payments || !capabilities.plan.stripe) {
      return NextResponse.json({ error: 'Payments not available on current plan' }, { status: 403 })
    }

    // 6. Check tenant has active Stripe connection
    const stripeEnabled = await isStripeEnabled(order.tenant_id)
    if (!stripeEnabled) {
      return NextResponse.json({ error: 'Stripe payments not configured for this tenant' }, { status: 403 })
    }

    // 7. Create (or reuse) the PaymentIntent. getOrCreatePaymentIntent reuses an
    // existing live intent and atomically persists payment_intent_id, so a
    // second call never leaves two chargeable intents for one order. Currency
    // and minor-unit conversion are resolved from the tenant's settings inside.
    const orderTotal = Number(order.total)
    if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
      return NextResponse.json({ error: 'Order total is invalid' }, { status: 400 })
    }
    const { clientSecret } = await getOrCreatePaymentIntent({
      tenantId: order.tenant_id,
      orderId: order.id,
      amountDollars: orderTotal,
      tipCents: (order as any).tip_cents ?? 0,
    })

    return NextResponse.json({ client_secret: clientSecret })
  } catch (error) {
    log.error('PaymentIntent creation error', { err: error })
    
    if (error instanceof Error) {
      if (error.message.includes('No active Stripe connection')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      if (error.message.includes('Payments not available')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
    }
    
    return NextResponse.json({ error: 'Failed to create payment intent' }, { status: 500 })
  }
}

export const POST = withApi('POST /api/stripe/payment-intents', handlePOST)
