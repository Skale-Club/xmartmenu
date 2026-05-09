/**
 * POST /api/stripe/payment-intents
 * 
 * Create a PaymentIntent for an order.
 * Requires authenticated session and valid pending order.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPaymentIntent, isStripeEnabled } from '@/lib/stripe'
import { getTenantPlan } from '@/lib/tenant-plan'

export async function POST(request: NextRequest) {
  try {
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

    // 3. Fetch order and verify ownership
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, tenant_id, status, total_cents')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // 4. Verify order status is pending
    if (order.status !== 'pending') {
      return NextResponse.json({ error: 'Order is not in pending status' }, { status: 400 })
    }

    // 5. Check tenant plan includes payments feature
    const plan = await getTenantPlan(order.tenant_id)
    if (!plan || !plan.features.includes('payments')) {
      return NextResponse.json({ error: 'Payments not available on current plan' }, { status: 403 })
    }

    // 6. Check tenant has active Stripe connection
    const stripeEnabled = await isStripeEnabled(order.tenant_id)
    if (!stripeEnabled) {
      return NextResponse.json({ error: 'Stripe payments not configured for this tenant' }, { status: 403 })
    }

    // 7. Create PaymentIntent
    const { clientSecret, paymentIntentId } = await createPaymentIntent({
      tenantId: order.tenant_id,
      orderId: order.id,
      amount: Math.floor(order.total_cents),
      currency: 'brl',
    })

    // 8. Update order with payment_intent_id
    const { error: updateError } = await supabase
      .from('orders')
      .update({ payment_intent_id: paymentIntentId })
      .eq('id', order.id)

    if (updateError) {
      console.error('Failed to update order with payment_intent_id:', updateError)
      // Continue anyway - PaymentIntent is created, order can be updated later
    }

    return NextResponse.json({ client_secret: clientSecret })
  } catch (error) {
    console.error('PaymentIntent creation error:', error)
    
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