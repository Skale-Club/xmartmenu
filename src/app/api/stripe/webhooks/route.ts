/**
 * POST /api/stripe/webhooks
 *
 * Handle Stripe webhook events with signature verification and idempotency.
 *
 * Critical implementation details:
 * - Uses request.text() for raw body (required for signature verification)
 * - Idempotency via processed_stripe_events table, recorded ONLY after the
 *   business logic succeeds — so a failed event is genuinely reprocessed on
 *   Stripe's retry instead of being short-circuited (R1 fix).
 * - Same service client (bypasses RLS) for idempotency + business logic.
 *
 * Routing:
 * - Order payments: payment_intent.* (metadata.order_id)
 * - SaaS plan subscriptions: checkout.session.completed / customer.subscription.*
 *   / invoice.payment_failed where metadata.kind === 'plan'
 * - AI chat addon: same events where metadata.addon === 'chat'
 * - Connect account health: account.updated
 */

import { NextRequest, NextResponse } from 'next/server'
import { stripe, toStripeAmount } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { captureSecurityEvent } from '@/lib/observability'
import { enqueueXphereSync } from '@/lib/xphere/queue'

type UpdateResult = { success: boolean; error?: string }

// Stripe timestamps are unix seconds; convert to ISO (or null).
function tsToIso(unix: number | null | undefined): string | null {
  return typeof unix === 'number' ? new Date(unix * 1000).toISOString() : null
}

export async function POST(request: NextRequest) {
  try {
    // 1. Get raw body and signature header
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      console.error('Missing Stripe signature header')
      captureSecurityEvent('Stripe webhook: missing signature header')
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
      captureSecurityEvent('Stripe webhook: signature verification failed', {
        message: sigError instanceof Error ? sigError.message : String(sigError),
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    // Webhook requests have no cookies; the service client bypasses RLS to write
    // orders, tenant_subscriptions, stripe_connections, and processed_stripe_events.
    const supabase = createServiceClient()
    const eventId = event.id

    // 3. Idempotency check - skip if already processed
    const { data: existingEvent } = await supabase
      .from('processed_stripe_events')
      .select('event_id')
      .eq('event_id', eventId)
      .single()

    if (existingEvent) {
      console.log(`Event ${eventId} already processed, skipping`)
      return NextResponse.json({ received: true, skipped: true })
    }

    // 4. Process event based on type
    let updateResult: UpdateResult = { success: true }

    // One enqueue per request, fired AFTER the idempotency row (so a Stripe
    // retry that short-circuits at the idempotency check never double-enqueues).
    // Each lifecycle branch sets this; the eventId carries Stripe event.id so the
    // CRM timeline note dedups on redelivery (LIF-07).
    let pendingSync:
      | { tenantId: string; reason: 'plan_activated' | 'plan_changed' | 'past_due' | 'churned' | 'connect_changed'; tags?: string[] }
      | null = null

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as {
          id: string
          amount: number
          metadata: { order_id?: string; tenant_id?: string }
        }
        const orderId = paymentIntent.metadata?.order_id

        if (orderId) {
          const { data: order, error: fetchErr } = await supabase
            .from('orders')
            .select('id, total, status')
            .eq('id', orderId)
            .single()

          if (fetchErr || !order) {
            console.error('payment_intent.succeeded for unknown order:', orderId, fetchErr)
            // Nothing to update; treat as processed so Stripe stops retrying.
            break
          }

          // Defense in depth: never mark an order paid for less than its total.
          // We always create the PaymentIntent with the exact order amount, so a
          // shortfall means tampering or a stale intent — block and alert.
          const expectedCents = toStripeAmount(Number(order.total))
          if (typeof paymentIntent.amount === 'number' && paymentIntent.amount < expectedCents) {
            captureSecurityEvent('Stripe webhook: payment amount below order total', {
              orderId,
              expectedCents,
              receivedCents: paymentIntent.amount,
              paymentIntentId: paymentIntent.id,
            })
            // Do NOT mark paid. Retrying won't fix a wrong amount, so record the
            // event (return 200 below) and leave the order for manual review.
            break
          }

          const { error: updateError } = await supabase
            .from('orders')
            .update({ status: 'paid', payment_intent_id: paymentIntent.id })
            .eq('id', orderId)
            .in('status', ['awaiting_payment', 'pending'])

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
            .update({ status: 'payment_failed', payment_intent_id: paymentIntent.id })
            .eq('id', orderId)
            .in('status', ['awaiting_payment', 'pending'])

          if (updateError) {
            console.error('Failed to update order to payment_failed:', updateError)
            updateResult = { success: false, error: updateError.message }
          }
        }
        break
      }

      case 'payment_intent.canceled': {
        // Abandoned/expired customer checkout — release the awaiting_payment order.
        const paymentIntent = event.data.object as {
          id: string
          metadata: { order_id?: string }
        }
        const orderId = paymentIntent.metadata?.order_id
        if (orderId) {
          const { error: updateError } = await supabase
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', orderId)
            .eq('status', 'awaiting_payment')
          if (updateError) {
            console.error('Failed to cancel awaiting_payment order:', updateError)
            updateResult = { success: false, error: updateError.message }
          }
        }
        break
      }

      case 'checkout.session.completed': {
        const session = event.data.object as {
          metadata?: { tenant_id?: string; addon?: string; kind?: string; plan_id?: string }
          customer?: string | null
          subscription?: string | null
        }
        const customerId = typeof session.customer === 'string' ? session.customer : null
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null
        const tenantId = session.metadata?.tenant_id

        if (session.metadata?.kind === 'plan' && tenantId) {
          // SaaS plan subscription activated. Periods are filled in by the
          // subsequent customer.subscription.updated event.
          const { error: subErr } = await supabase
            .from('tenant_subscriptions')
            .update({
              status: 'active',
              cancel_at_period_end: false,
              ...(session.metadata.plan_id ? { plan_id: session.metadata.plan_id } : {}),
              ...(customerId ? { stripe_customer_id: customerId } : {}),
              ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
            })
            .eq('tenant_id', tenantId)
          if (subErr) {
            console.error('Failed to activate plan subscription:', subErr)
            updateResult = { success: false, error: subErr.message }
          }
          // #2 (LIF-02): paid plan activated → Opportunity moves to Active/Won.
          // Guard on !subErr so a failed update (which 500s) does not enqueue.
          if (!subErr) pendingSync = { tenantId, reason: 'plan_activated' }
        } else if (session.metadata?.addon === 'chat' && tenantId) {
          // SEED-024: AI Chat Addon activation
          const { error: subErr } = await supabase
            .from('tenant_subscriptions')
            .update({
              chat_addon_active: true,
              chat_addon_since: new Date().toISOString(),
              ...(customerId ? { stripe_customer_id: customerId } : {}),
            })
            .eq('tenant_id', tenantId)
          if (subErr) {
            console.error('Failed to activate chat addon:', subErr)
            updateResult = { success: false, error: subErr.message }
          }
        }
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as {
          id: string
          status: string
          metadata?: { tenant_id?: string; addon?: string; kind?: string }
          cancel_at_period_end?: boolean
          current_period_start?: number | null
          current_period_end?: number | null
          items?: { data?: Array<{ current_period_start?: number | null; current_period_end?: number | null }> }
        }
        const tenantId = sub.metadata?.tenant_id
        const deleted = event.type === 'customer.subscription.deleted'

        // Recent Stripe API versions moved current_period_start/end from the
        // Subscription to the SubscriptionItem. Read the item, falling back to
        // the top-level field for older versions.
        const periodItem = sub.items?.data?.[0]
        const periodStart = sub.current_period_start ?? periodItem?.current_period_start
        const periodEnd = sub.current_period_end ?? periodItem?.current_period_end

        if (sub.metadata?.kind === 'plan' && tenantId) {
          // SaaS plan subscription lifecycle → mirror into tenant_subscriptions.
          let status: 'active' | 'cancelled' | 'trial' | 'past_due' = 'active'
          if (deleted) status = 'cancelled'
          else if (sub.status === 'trialing') status = 'trial'
          else if (sub.status === 'past_due' || sub.status === 'unpaid') status = 'past_due'
          else if (sub.status === 'canceled') status = 'cancelled'
          else status = 'active' // active / incomplete treated as active

          // #3 (LIF-03): read the PRIOR plan_id BEFORE the update so we can detect
          // a plan change and tag direction. (This branch's update does not change
          // plan_id, but checkout.session.completed may have, and the
          // subscription.updated event reflects the new plan via Stripe.)
          let priorPlanId: string | null = null
          if (!deleted) {
            const { data: priorSub } = await supabase
              .from('tenant_subscriptions')
              .select('plan_id')
              .eq('tenant_id', tenantId)
              .eq('stripe_subscription_id', sub.id)
              .maybeSingle()
            priorPlanId = priorSub?.plan_id ?? null
          }

          // Resolve the NEW plan_id from the Stripe subscription's first item price
          // id → plans row. Column names per src/types/database.ts Plan interface
          // (stripe_price_monthly_id / stripe_price_annual_id).
          const newPriceId =
            (sub as { items?: { data?: Array<{ price?: { id?: string } }> } }).items?.data?.[0]?.price?.id ?? null
          let newPlanId: string | null = null
          if (!deleted && newPriceId) {
            const { data: planRow } = await supabase
              .from('plans')
              .select('id')
              .or(`stripe_price_monthly_id.eq.${newPriceId},stripe_price_annual_id.eq.${newPriceId}`)
              .maybeSingle()
            newPlanId = planRow?.id ?? null
          }

          const { error } = await supabase
            .from('tenant_subscriptions')
            .update({
              status,
              cancel_at_period_end: sub.cancel_at_period_end ?? false,
              current_period_start: tsToIso(periodStart),
              current_period_end: tsToIso(periodEnd),
            })
            .eq('tenant_id', tenantId)
            .eq('stripe_subscription_id', sub.id)
          if (error) {
            console.error('Failed to sync plan subscription:', error)
            updateResult = { success: false, error: error.message }
          }
          // #5 (LIF-05) churn — deleted path only.
          if (!error && deleted) {
            pendingSync = { tenantId, reason: 'churned' }
          }
          // #3 (LIF-03) plan change — updated path only. Detect a genuine plan
          // change (both ids resolve AND differ) and tag direction by tier
          // (plans.sort_order). A status-only update must NOT enqueue plan_changed.
          // deleted (churn) and !deleted (plan_changed) are mutually exclusive, so
          // this never clobbers the churn pendingSync above.
          if (!error && !deleted && newPlanId && priorPlanId && newPlanId !== priorPlanId) {
            const { data: tierRows } = await supabase
              .from('plans')
              .select('id, sort_order')
              .in('id', [priorPlanId, newPlanId])
            const priorOrder = tierRows?.find((p) => p.id === priorPlanId)?.sort_order ?? 0
            const newOrder = tierRows?.find((p) => p.id === newPlanId)?.sort_order ?? 0
            const direction = newOrder > priorOrder ? 'upgrade' : 'downgrade'
            pendingSync = { tenantId, reason: 'plan_changed', tags: [direction] }
          }
        } else if (sub.metadata?.addon === 'chat' && tenantId) {
          // SEED-024: addon stays active while the subscription is live. A
          // pending cancellation (cancel_at_period_end) keeps it usable until
          // Stripe sends the deletion at period end — so we do NOT zero it early
          // (C1 fix: the old nested ternary made cancel_at_period_end a no-op and
          // was unreadable).
          const active = !deleted && (sub.status === 'active' || sub.status === 'trialing')
          const { error: subErr } = await supabase
            .from('tenant_subscriptions')
            .update({ chat_addon_active: active })
            .eq('tenant_id', tenantId)
          if (subErr) updateResult = { success: false, error: subErr.message }
          if (!active) {
            // Also disable the widget so it disappears immediately
            await supabase
              .from('chat_addon_settings')
              .update({ enabled: false })
              .eq('tenant_id', tenantId)
          }
        }
        break
      }

      case 'invoice.payment_failed': {
        // SaaS plan dunning → mark the tenant past_due. Only the plan
        // subscription stores stripe_subscription_id, so matching on it scopes
        // this to plans (chat addon invoices won't match).
        const invoice = event.data.object as { subscription?: string | null }
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : null
        if (subscriptionId) {
          const { error } = await supabase
            .from('tenant_subscriptions')
            .update({ status: 'past_due' })
            .eq('stripe_subscription_id', subscriptionId)
          if (error) {
            console.error('Failed to mark subscription past_due:', error)
            updateResult = { success: false, error: error.message }
          }
          // #4 (LIF-04): dunning → Opportunity At Risk. This branch only carries
          // the stripe_subscription_id, so resolve the tenant_id before enqueuing.
          if (!error) {
            const { data: subRow } = await supabase
              .from('tenant_subscriptions')
              .select('tenant_id')
              .eq('stripe_subscription_id', subscriptionId)
              .maybeSingle()
            if (subRow?.tenant_id) {
              pendingSync = { tenantId: subRow.tenant_id, reason: 'past_due' }
            }
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

        const { data: connection } = await supabase
          .from('stripe_connections')
          .select('id, is_active, tenant_id')
          .eq('stripe_account_id', account.id)
          .single()

        if (connection) {
          // C2 fix: only DISABLE on a persistent signal (charges_enabled=false).
          // payouts_enabled flaps during Stripe's periodic reviews, so we no
          // longer tear the connection down just because payouts are briefly
          // paused — that would silently break checkout for the tenant.
          const shouldBeActive = account.charges_enabled
          if (connection.is_active !== shouldBeActive) {
            await supabase
              .from('stripe_connections')
              .update({ is_active: shouldBeActive })
              .eq('id', connection.id)
            if (!shouldBeActive) {
              captureSecurityEvent('Stripe Connect: charges disabled on connected account', {
                stripeAccountId: account.id,
              })
            }
          }
          // #6 (LIF-06, webhook half): connect enable/disable transition → mirror
          // connect:active / connect:disabled into the CRM. The OAuth-callback half
          // is wired in plan 52-02.
          if (connection.tenant_id) {
            pendingSync = { tenantId: connection.tenant_id, reason: 'connect_changed' }
          }
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    // 5. On failure, do NOT record idempotency — return 500 so Stripe retries
    // and the event is genuinely reprocessed (all handlers above are idempotent).
    if (!updateResult.success) {
      console.error(`Event ${eventId} business logic failed: ${updateResult.error}`)
      return NextResponse.json({ received: false, error: updateResult.error }, { status: 500 })
    }

    // 6. Record idempotency only after success, then 200.
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
      // The work succeeded; a duplicate delivery would just redo idempotent work.
    }

    // Fire the single CRM enqueue AFTER the idempotency row is recorded and only
    // on the success path — mirrors the Stripe idempotency-after-success rule.
    // enqueueXphereSync is fail-open (never throws), so a QStash outage cannot
    // flip this 200 to 500. eventId = Stripe event.id dedups the CRM note (LIF-07).
    if (pendingSync) {
      await enqueueXphereSync(pendingSync.tenantId, pendingSync.reason, {
        eventId,
        ...(pendingSync.tags ? { tags: pendingSync.tags } : {}),
      })
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook processing error:', error)
    // Unexpected error — return 500 so Stripe retries.
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }
}
