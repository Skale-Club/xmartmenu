/**
 * Applies payment evidence to an order (EX-04). The Stripe webhook and the
 * confirmation page (reading the PaymentIntent back from Stripe when the
 * webhook is late) both go through here, so they cannot disagree.
 *
 * Before anything changes, the intent must belong to the order's restaurant,
 * be in the order's currency and cover the order total. Payment signals for
 * an intent that is no longer the order's current one are ignored, except a
 * successful charge, which is money: it pays an unpaid order, and is recorded
 * as a divergence when the order was already paid or cancelled.
 *
 * Updates are compare-and-set on the status read, retried on a race, so two
 * deliveries of the same event make one transition and one analytics event.
 * A database error is returned (ok: false) so the webhook answers 500 and
 * Stripe retries; the event is only marked processed after success.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantCurrency, toStripeAmount } from '@/lib/stripe'
import { recordTrustedOrderAnalyticsEvent } from '@/lib/analytics/server'
import { captureSecurityEvent } from '@/lib/observability'
import { log } from '@/lib/observability/log'
import { paymentTransition, type PaymentSignal } from '@/lib/orders/status-machine'

export interface IntentFacts {
  id: string
  amount: number
  currency: string
  metadata?: { order_id?: string; tenant_id?: string } | null
}

export interface PaymentSyncResult {
  ok: boolean
  /** The order's status after this call (when the order exists). */
  status?: string
  changed: boolean
  error?: string
}

type OrderRow = { id: string; tenant_id: string; status: string; total: number | string; payment_intent_id: string | null; currency?: string | null }

const PAID_LIKE = new Set(['paid', 'preparing', 'ready', 'out_for_delivery', 'done'])

async function recordDivergence(
  supabase: SupabaseClient,
  order: OrderRow | null,
  intent: IntentFacts,
  kind: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await supabase.from('payment_divergences').upsert({
    order_id: order?.id ?? null,
    tenant_id: order?.tenant_id ?? null,
    payment_intent_id: intent.id,
    kind,
    amount_minor: intent.amount,
    currency: intent.currency,
    details,
  }, { onConflict: 'payment_intent_id,kind', ignoreDuplicates: true })
  if (error) log.error('payments.divergence_record_error', { err: error, kind })
  log.warn('payments.divergence', { kind, order_id: order?.id, payment_intent_id: intent.id })
}

export async function applyPaymentSignal(
  supabase: SupabaseClient,
  intent: IntentFacts,
  signal: PaymentSignal,
): Promise<PaymentSyncResult> {
  const orderId = intent.metadata?.order_id
  if (!orderId) return { ok: true, changed: false }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: order, error: readError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle<OrderRow>()
    if (readError) return { ok: false, changed: false, error: readError.message }
    if (!order) {
      log.error('payments.unknown_order', { order_id: orderId, payment_intent_id: intent.id })
      return { ok: true, changed: false }
    }

    if (intent.metadata?.tenant_id && intent.metadata.tenant_id !== order.tenant_id) {
      captureSecurityEvent('Stripe payment for an order of another restaurant', { orderId, paymentIntentId: intent.id })
      await recordDivergence(supabase, order, intent, 'tenant_mismatch', { metadata_tenant: intent.metadata.tenant_id })
      return { ok: true, status: order.status, changed: false }
    }

    const isCurrentIntent = !order.payment_intent_id || order.payment_intent_id === intent.id
    // A failure or cancellation of an intent the order no longer uses (the
    // loser of a checkout race, a replaced intent) says nothing about the order.
    if (!isCurrentIntent && signal !== 'succeeded') return { ok: true, status: order.status, changed: false }

    if (signal === 'succeeded') {
      const expectedCurrency = (order.currency ?? await getTenantCurrency(order.tenant_id, supabase)).toLowerCase()
      if (intent.currency.toLowerCase() !== expectedCurrency) {
        captureSecurityEvent('Stripe payment in the wrong currency', { orderId, paymentIntentId: intent.id })
        await recordDivergence(supabase, order, intent, 'currency_mismatch', { expected: expectedCurrency })
        return { ok: true, status: order.status, changed: false }
      }
      const expectedMinor = toStripeAmount(Number(order.total), intent.currency)
      if (intent.amount < expectedMinor) {
        captureSecurityEvent('Stripe webhook: payment amount below order total', { orderId, expectedCents: expectedMinor, receivedCents: intent.amount, paymentIntentId: intent.id })
        await recordDivergence(supabase, order, intent, 'amount_below_total', { expected_minor: expectedMinor })
        return { ok: true, status: order.status, changed: false }
      }
      if (!isCurrentIntent && PAID_LIKE.has(order.status)) {
        await recordDivergence(supabase, order, intent, 'second_payment', { current_intent: order.payment_intent_id })
        return { ok: true, status: order.status, changed: false }
      }
    }

    const transition = paymentTransition(order.status, signal)
    if (transition.divergence) {
      await recordDivergence(supabase, order, intent, transition.divergence)
    }
    if (!transition.next) return { ok: true, status: order.status, changed: false }

    const patch: Record<string, unknown> = { status: transition.next, updated_at: new Date().toISOString() }
    if (signal === 'succeeded') patch.payment_intent_id = intent.id

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', order.id)
      .eq('status', order.status) // compare-and-set: lose a race → re-read and decide again
      .select('id, status')
    if (updateError) return { ok: false, changed: false, error: updateError.message }
    if (!updated || updated.length === 0) continue

    if (transition.next === 'paid') await recordTrustedOrderAnalyticsEvent(order.id, 'order_completed')
    if (transition.next === 'cancelled') await recordTrustedOrderAnalyticsEvent(order.id, 'order_cancelled')
    return { ok: true, status: transition.next, changed: true }
  }
  return { ok: false, changed: false, error: 'order kept changing while applying the payment' }
}

/** Stripe PaymentIntent status → the signal it means for the order, if any. */
export function signalForIntentStatus(status: string): PaymentSignal | null {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'canceled') return 'canceled'
  return null
}
