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
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { captureSecurityEvent } from '@/lib/observability'
import { enqueueXphereSync } from '@/lib/xphere/queue'
import { applyPaymentSignal, type IntentFacts } from '@/lib/orders/payment-sync'
import type { PaymentSignal } from '@/lib/orders/status-machine'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'
import { billAiUsage, subscriptionIdFromInvoice } from '@/lib/ai/billing'
import { reconcileTenantSettings } from '@/lib/tenant-plan'

type UpdateResult = { success: boolean; error?: string }

// Stripe timestamps are unix seconds; convert to ISO (or null).
function tsToIso(unix: number | null | undefined): string | null {
  return typeof unix === 'number' ? new Date(unix * 1000).toISOString() : null
}

async function handlePOST(request: NextRequest) {
  try {
    // 1. Get raw body and signature header
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      log.error('Missing Stripe signature header')
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
      log.error('Webhook signature verification failed', { err: sigError })
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
      // Order payments: one transition matrix and one set of checks
      // (src/lib/orders/payment-sync.ts) for success, failure and cancellation.
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as IntentFacts
        const signal: PaymentSignal = event.type === 'payment_intent.succeeded'
          ? 'succeeded'
          : event.type === 'payment_intent.payment_failed' ? 'failed' : 'canceled'
        const result = await applyPaymentSignal(supabase, paymentIntent, signal)
        if (!result.ok) {
          log.error('payments.apply_error', { err: result.error, event_type: event.type })
          updateResult = { success: false, error: result.error }
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
            log.error('Failed to activate plan subscription', { err: subErr })
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
            log.error('Failed to activate chat addon', { err: subErr })
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
          // Only 'active'/'trialing' grant access. incomplete / incomplete_expired
          // / paused / unpaid must NOT map to 'active' (a paused or never-paid
          // subscription would otherwise keep the tenant fully enabled for free).
          let status: 'active' | 'cancelled' | 'trial' | 'past_due'
          if (deleted || sub.status === 'canceled' || sub.status === 'incomplete_expired') status = 'cancelled'
          else if (sub.status === 'trialing') status = 'trial'
          else if (sub.status === 'active') status = 'active'
          else status = 'past_due' // past_due / unpaid / incomplete / paused → not live

          // #3 (LIF-03): read the PRIOR plan_id BEFORE the update so we can detect
          // a plan change and tag direction. (This branch's update does not change
          // plan_id, but checkout.session.completed may have, and the
          // subscription.updated event reflects the new plan via Stripe.)
          // Read the prior plan by tenant (one subscription row per tenant). We
          // deliberately match on tenant_id, NOT stripe_subscription_id: Stripe
          // does not guarantee event order, so a subscription.updated that lands
          // before checkout.session.completed (which writes stripe_subscription_id)
          // must still update the tenant's row instead of matching 0 rows and
          // silently dropping period/status for the whole cycle.
          let priorPlanId: string | null = null
          if (!deleted) {
            const { data: priorSub } = await supabase
              .from('tenant_subscriptions')
              .select('plan_id')
              .eq('tenant_id', tenantId)
              .maybeSingle()
            priorPlanId = priorSub?.plan_id ?? null
          }

          // Resolve the NEW plan_id + billing_cycle from the Stripe subscription's
          // first item price id → plans row. Column names per src/types/database.ts
          // Plan interface (stripe_price_monthly_id / stripe_price_annual_id).
          const newPriceId =
            (sub as { items?: { data?: Array<{ price?: { id?: string } }> } }).items?.data?.[0]?.price?.id ?? null
          let newPlanId: string | null = null
          let newBillingCycle: 'monthly' | 'annual' | null = null
          if (!deleted && newPriceId) {
            const { data: planRow } = await supabase
              .from('plans')
              .select('id, stripe_price_annual_id')
              .or(`stripe_price_monthly_id.eq.${newPriceId},stripe_price_annual_id.eq.${newPriceId}`)
              .maybeSingle()
            newPlanId = planRow?.id ?? null
            if (planRow) newBillingCycle = planRow.stripe_price_annual_id === newPriceId ? 'annual' : 'monthly'
          }

          const { error } = await supabase
            .from('tenant_subscriptions')
            .update({
              status,
              cancel_at_period_end: sub.cancel_at_period_end ?? false,
              current_period_start: tsToIso(periodStart),
              current_period_end: tsToIso(periodEnd),
              // Backfill the subscription id (in case this event arrived before
              // checkout.session.completed) and keep plan/cycle in sync.
              stripe_subscription_id: sub.id,
              ...(newPlanId ? { plan_id: newPlanId } : {}),
              ...(newBillingCycle ? { billing_cycle: newBillingCycle } : {}),
            })
            .eq('tenant_id', tenantId)
          if (error) {
            log.error('Failed to sync plan subscription', { err: error })
            updateResult = { success: false, error: error.message }
          } else {
            // The plan or status may have just dropped (downgrade, cancel,
            // dunning): switch off whatever the new ceiling no longer allows.
            // Failing the event makes Stripe retry it; every step is idempotent.
            const reconciled = await reconcileTenantSettings(tenantId, supabase)
            if (!reconciled.ok) {
              log.error('Failed to reconcile settings with plan', { err: reconciled.error, tenant_id: tenantId })
              updateResult = { success: false, error: reconciled.error }
            }
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

      case 'invoice.created': {
        // Plan renewal invoice, still a draft: add the client's AI usage
        // (real cost + margin) before Stripe finalises it (src/lib/ai/billing.ts).
        const invoice = event.data.object as Parameters<typeof subscriptionIdFromInvoice>[0] & {
          id: string
          status?: string | null
          currency?: string | null
          billing_reason?: string | null
        }
        const subscriptionId = subscriptionIdFromInvoice(invoice)
        if (invoice.status === 'draft' && invoice.billing_reason === 'subscription_cycle' && subscriptionId) {
          const { data: subRow } = await supabase
            .from('tenant_subscriptions')
            .select('tenant_id')
            .eq('stripe_subscription_id', subscriptionId)
            .maybeSingle()
          if (subRow?.tenant_id) {
            try {
              await billAiUsage({ tenantId: subRow.tenant_id, invoiceId: invoice.id, currency: invoice.currency ?? undefined })
            } catch (error) {
              // The usage stays unbilled and goes on the next invoice or "Bill now".
              log.error('ai.billing_failed', { err: error, tenant_id: subRow.tenant_id, invoice: invoice.id })
            }
          }
        }
        break
      }

      case 'invoice.payment_failed': {
        // SaaS plan dunning → mark the tenant past_due. Only the plan
        // subscription stores stripe_subscription_id, so matching on it scopes
        // this to plans (chat addon invoices won't match).
        // The pinned API version (2026-04-22.dahlia, post-Basil) removed the
        // top-level invoice.subscription field; the subscription now lives under
        // invoice.parent.subscription_details.subscription (with a line-item
        // fallback). Read all shapes so dunning still marks tenants past_due.
        const invoice = event.data.object as {
          subscription?: string | null
          parent?: { subscription_details?: { subscription?: string | null } | null } | null
          lines?: { data?: Array<{ parent?: { subscription_item_details?: { subscription?: string | null } | null } | null }> }
        }
        const lineSub = invoice.lines?.data?.find(
          (l) => typeof l.parent?.subscription_item_details?.subscription === 'string',
        )?.parent?.subscription_item_details?.subscription
        const subscriptionId =
          (typeof invoice.subscription === 'string' ? invoice.subscription : null) ??
          (typeof invoice.parent?.subscription_details?.subscription === 'string'
            ? invoice.parent.subscription_details.subscription
            : null) ??
          (typeof lineSub === 'string' ? lineSub : null)
        if (subscriptionId) {
          const { error } = await supabase
            .from('tenant_subscriptions')
            .update({ status: 'past_due' })
            .eq('stripe_subscription_id', subscriptionId)
          if (error) {
            log.error('Failed to mark subscription past_due', { err: error })
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
              // past_due revokes the plan's features (getTenantPlan): switch off
              // what no longer has a plan behind it.
              const reconciled = await reconcileTenantSettings(subRow.tenant_id, supabase)
              if (!reconciled.ok) {
                log.error('Failed to reconcile settings after payment failure', { err: reconciled.error, tenant_id: subRow.tenant_id })
                updateResult = { success: false, error: reconciled.error }
              }
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
      log.error('Event ${eventId} business logic failed: ${updateResult.error}')
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
      log.error('Failed to record processed event', { err: insertError })
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
    log.error('Webhook processing error', { err: error })
    // Unexpected error — return 500 so Stripe retries.
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }
}

export const POST = withApi('POST /api/stripe/webhooks', handlePOST)
