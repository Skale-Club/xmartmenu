/**
 * Checkout confirmation page
 * Phase 33: Payment Intent + Webhook; EX-04: confirmation from server evidence.
 *
 * Stripe redirects here with ?redirect_status=…, but a query string is
 * navigation, not proof: anyone can type redirect_status=succeeded. What the
 * page shows comes from the order in the database, and while the order still
 * waits for its payment, from the order's PaymentIntent read back from Stripe
 * (applied through the same rules as the webhook, so a late webhook does not
 * leave the guest staring at a spinner).
 */

import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { formatPrice } from '@/lib/utils'
import { embeddedCurrency } from '@/components/menu/menu-utils'
import { stripe } from '@/lib/stripe'
import { applyPaymentSignal, signalForIntentStatus } from '@/lib/orders/payment-sync'
import { log } from '@/lib/observability/log'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import AutoRefresh from './AutoRefresh'

interface ConfirmationPageProps {
  params: Promise<{ orderId: string }>
}

const PAID_LIKE = new Set(['paid', 'preparing', 'ready', 'out_for_delivery', 'done'])
const WAITING = new Set(['awaiting_payment', 'pending'])

type ConfirmationState = 'paid' | 'processing' | 'failed' | 'cancelled'

export default async function ConfirmationPage({ params }: ConfirmationPageProps) {
  const { orderId } = await params
  // Anonymous customer context — read the order by its unguessable UUID via the
  // service client (RLS on `orders` is admin/staff-only). See checkout page.
  const supabase = createServiceClient()

  const loadOrder = () => supabase
    .from('orders')
    .select('*, tenants(slug, name, tenant_settings(currency))')
    .eq('id', orderId)
    .maybeSingle()

  let { data: order } = await loadOrder()

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Order Not Found</h1>
          <Link href="/" className="text-indigo-600 hover:text-indigo-700">Return to Home</Link>
        </div>
      </div>
    )
  }

  // Still waiting for its payment: ask Stripe about the order's own intent.
  let intentFailed = false
  if ((WAITING.has(order.status) || order.status === 'payment_failed') && order.payment_intent_id) {
    try {
      const intent = await stripe.paymentIntents.retrieve(order.payment_intent_id)
      const signal = signalForIntentStatus(intent.status)
      if (signal) {
        const result = await applyPaymentSignal(supabase, intent, signal)
        if (result.changed) order = (await loadOrder()).data ?? order
      }
      intentFailed = intent.status === 'requires_payment_method' && !!intent.last_payment_error
    } catch (err) {
      log.error('payments.confirmation_lookup_error', { err, order_id: orderId })
    }
  }

  const state: ConfirmationState = PAID_LIKE.has(order.status)
    ? 'paid'
    : order.status === 'cancelled'
      ? 'cancelled'
      : order.status === 'payment_failed' || intentFailed
        ? 'failed'
        : 'processing'

  const total = formatPrice(Number(order.total ?? 0), embeddedCurrency(order.tenants))
  const slug = order.tenants?.slug as string | undefined

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      {state === 'processing' && <AutoRefresh />}
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        {state === 'paid' && (
          <>
            <div className="flex justify-center mb-4"><CheckCircle className="w-16 h-16 text-green-500" /></div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Confirmed!</h1>
            <p className="text-gray-600 mb-6">Your payment has been processed successfully.</p>
          </>
        )}
        {state === 'processing' && (
          <>
            <div className="flex justify-center mb-4"><Loader2 className="w-16 h-16 text-yellow-500 animate-spin" /></div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Processing Payment</h1>
            <p className="text-gray-600 mb-6">We&apos;re verifying your payment. This page updates on its own.</p>
          </>
        )}
        {state === 'failed' && (
          <>
            <div className="flex justify-center mb-4"><XCircle className="w-16 h-16 text-red-500" /></div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h1>
            <p className="text-gray-600 mb-6">Your payment could not be processed. You can try again or use a different payment method.</p>
          </>
        )}
        {state === 'cancelled' && (
          <>
            <div className="flex justify-center mb-4"><XCircle className="w-16 h-16 text-gray-400" /></div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Cancelled</h1>
            <p className="text-gray-600 mb-6">This order was cancelled. If you were charged, the restaurant will review it.</p>
          </>
        )}

        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
          <p className="text-sm text-gray-500 mb-2">Order Details</p>
          <p className="font-semibold text-gray-900">{order.tenants?.name}</p>
          <p className="text-sm text-gray-600">Total: {total}</p>
        </div>

        <div className="space-y-3">
          {state === 'failed' && (
            <Link
              href={`/checkout/${orderId}`}
              className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Try Again
            </Link>
          )}
          {slug && (
            <Link
              href={`/${slug}`}
              className={state === 'failed'
                ? 'block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-4 rounded-lg transition-colors'
                : 'block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors'}
            >
              Return to Menu
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
