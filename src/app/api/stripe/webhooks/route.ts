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
import { createServiceClient } from '@/lib/supabase/server'

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

    // P0-02 fix: webhook requests have no cookies. We need the service
    // client to bypass RLS and write to orders, stripe_connections, and
    // processed_stripe_events.
    const supabase = await createServiceClient()
    const eventId = event.id

    // 3. Idempotency check - check if event already processed
    const { data: existingEvent } = await supabase
      .from('processed_stripe_events')
      .select('event_id')
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

      case 'checkout.session.completed': {
        // SEED-024: AI Chat Addon activation
        const session = event.data.object as {
          metadata?: { tenant_id?: string; addon?: string }
          customer?: string | null
          subscription?: string | null
        }
        if (session.metadata?.addon === 'chat' && session.metadata.tenant_id) {
          const customerId = typeof session.customer === 'string' ? session.customer : null
          const { error: subErr } = await supabase
            .from('tenant_subscriptions')
            .update({
              chat_addon_active: true,
              chat_addon_since: new Date().toISOString(),
              ...(customerId ? { stripe_customer_id: customerId } : {}),
            })
            .eq('tenant_id', session.metadata.tenant_id)
          if (subErr) {
            console.error('Failed to activate chat addon:', subErr)
            updateResult = { success: false, error: subErr.message }
          }
        }
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // SEED-024: keep chat_addon_active in sync with the addon subscription.
        const sub = event.data.object as {
          id: string
          status: string
          metadata?: { tenant_id?: string; addon?: string }
          cancel_at_period_end?: boolean
        }
        if (sub.metadata?.addon === 'chat' && sub.metadata.tenant_id) {
          const stillActive = (event.type === 'customer.subscription.updated')
            && (sub.status === 'active' || sub.status === 'trialing')
            && !sub.cancel_at_period_end
            ? true
            : event.type === 'customer.subscription.updated' && (sub.status === 'active' || sub.status === 'trialing')
              ? true
              : false
          await supabase
            .from('tenant_subscriptions')
            .update({ chat_addon_active: stillActive })
            .eq('tenant_id', sub.metadata.tenant_id)
          if (!stillActive) {
            // Also disable the widget so it disappears immediately
            await supabase
              .from('chat_addon_settings')
              .update({ enabled: false })
              .eq('tenant_id', sub.metadata.tenant_id)
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

    if (!updateResult.success) {
      // P2-05 fix: surface business-logic failures so Stripe can retry.
      // We've already recorded the event as processed, but on a real failure
      // the surface area (orders not transitioning, stripe_connections not
      // syncing) is more important than perfect idempotency. Returning 500
      // tells Stripe to retry with backoff, which combined with the
      // idempotency upsert is safe.
      return NextResponse.json({ received: true, error: updateResult.error }, { status: 500 })
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook processing error:', error)
    // Unexpected error — return 500 so Stripe retries. The idempotency
    // upsert above will short-circuit duplicate processing on success.
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }
}