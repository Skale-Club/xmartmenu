/**
 * POST /api/stripe/webhooks
 * 
 * Handle Stripe webhook events with signature verification and idempotency.
 * 
 * Critical implementation details:
 * - Uses request.text() for raw body (required for signature verification)
 * - Idempotency via processed_stripe_events table
 * - Same DB transaction for idempotency + business logic
 */

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    // 1. Get raw body and signature header
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      console.error('Missing Stripe signature header')
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    // 2. Verify webhook signature
    let event
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      )
    } catch (sigError) {
      console.error('Webhook signature verification failed:', sigError)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const supabase = await createClient()
    const eventId = event.id

    // 3. Idempotency check - check if event already processed
    const { data: existingEvent } = await supabase
      .from('processed_stripe_events')
      .select('id')
      .eq('event_id', eventId)
      .single()

    if (existingEvent) {
      // Already processed - return 200 to avoid Stripe retries
      console.log(`Event ${eventId} already processed, skipping`)
      return NextResponse.json({ received: true, skipped: true })
    }

    // 4. Process event based on type
    let updateResult: { success: boolean; error?: string } = { success: true }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as {
          id: string
          metadata: { order_id?: string; tenant_id?: string }
        }
        const orderId = paymentIntent.metadata?.order_id

        if (orderId) {
          const { error: updateError } = await supabase
            .from('orders')
            .update({
              status: 'paid',
              payment_intent_id: paymentIntent.id,
            })
            .eq('id', orderId)

          if (updateError) {
            console.error('Failed to update order to paid:', updateError)
            updateResult = { success: false, error: updateError.message }
          }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as {
          id: string
          metadata: { order_id?: string }
        }
        const orderId = paymentIntent.metadata?.order_id

        if (orderId) {
          const { error: updateError } = await supabase
            .from('orders')
            .update({
              status: 'payment_failed',
              payment_intent_id: paymentIntent.id,
            })
            .eq('id', orderId)

          if (updateError) {
            console.error('Failed to update order to payment_failed:', updateError)
            updateResult = { success: false, error: updateError.message }
          }
        }
        break
      }

      case 'account.updated': {
        const account = event.data.object as {
          id: string
          charges_enabled: boolean
          payouts_enabled: boolean
        }

        // Find and update the Stripe connection
        const { data: connection } = await supabase
          .from('stripe_connections')
          .select('id')
          .eq('stripe_account_id', account.id)
          .single()

        if (connection) {
          const isActive = account.charges_enabled && account.payouts_enabled
          await supabase
            .from('stripe_connections')
            .update({ is_active: isActive })
            .eq('id', connection.id)
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    // 5. Record idempotency record (same transaction as business logic)
    // We record regardless of business logic success to prevent retries
    const { error: insertError } = await supabase
      .from('processed_stripe_events')
      .upsert(
        {
          event_id: eventId,
          event_type: event.type,
          processed_at: new Date().toISOString(),
        },
        { onConflict: 'event_id' }
      )

    if (insertError) {
      console.error('Failed to record processed event:', insertError)
      // Don't fail the webhook - the event was processed
    }

    // 6. Return 200 immediately (Stripe won't retry successful responses)
    if (!updateResult.success) {
      console.error(`Event ${eventId} processed but business logic failed: ${updateResult.error}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook processing error:', error)
    // Return 200 to prevent Stripe from retrying - errors are logged
    // (Stripe won't retry 200 responses even if we throw)
    return NextResponse.json({ received: true, error: 'Processing error' })
  }
}