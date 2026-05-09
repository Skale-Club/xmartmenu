/**
 * Checkout page with Stripe Payment Element
 * Phase 33: Payment Intent + Webhook
 */

import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { isStripeEnabled, getOrCreatePaymentIntent } from '@/lib/stripe'
import { StripeProvider } from '@/components/StripeProvider'
import { CheckoutForm } from './CheckoutForm'
import { ArrowLeft, ShoppingBag } from 'lucide-react'
import Link from 'next/link'

interface CheckoutPageProps {
  params: Promise<{ orderId: string }>
}

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { orderId } = await params
  const supabase = await createClient()

  // Fetch order with items and tenant info
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, order_items(*), tenants(slug, name)')
    .eq('id', orderId)
    .single()

  // Handle order not found
  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Order Not Found</h1>
          <p className="text-gray-600 mb-6">The order you're looking for doesn't exist or has been removed.</p>
          <Link
            href="/"
            className="inline-flex items-center text-indigo-600 hover:text-indigo-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Return to menu
          </Link>
        </div>
      </div>
    )
  }

  // Check order status - only pending orders can be paid
  if (order.status !== 'pending') {
    const statusMessages: Record<string, string> = {
      paid: 'This order has already been paid.',
      payment_failed: 'Payment for this order failed. Please try again.',
      cancelled: 'This order has been cancelled.',
      preparing: 'This order is being prepared.',
      ready: 'This order is ready for pickup.',
      done: 'This order has been completed.',
    }

    const message = statusMessages[order.status] || 'This order cannot be paid.'

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Order Status</h1>
          <p className="text-gray-600 mb-6">{message}</p>
          <Link
            href={`/confirmation/${order.id}`}
            className="inline-flex items-center text-indigo-600 hover:text-indigo-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            View Order
          </Link>
        </div>
      </div>
    )
  }

  // Check tenant has Stripe enabled
  const stripeEnabled = await isStripeEnabled(order.tenant_id)
  if (!stripeEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Payments Not Available</h1>
          <p className="text-gray-600 mb-6">
            This restaurant has not configured payment processing yet.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Please contact the restaurant to complete your order.
          </p>
          <Link
            href={`/menu/${order.tenants.slug}`}
            className="inline-flex items-center text-indigo-600 hover:text-indigo-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Return to menu
          </Link>
        </div>
      </div>
    )
  }

  // Create or get PaymentIntent
  let clientSecret: string
  try {
    const result = await getOrCreatePaymentIntent({
      tenantId: order.tenant_id,
      orderId: order.id,
      amount: Math.floor(order.total_cents),
      currency: 'brl',
    })
    clientSecret = result.clientSecret
  } catch (err) {
    console.error('Failed to create payment intent:', err)
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Payment Error</h1>
          <p className="text-gray-600 mb-6">Failed to initialize payment. Please try again later.</p>
          <Link
            href={`/menu/${order.tenants.slug}`}
            className="inline-flex items-center text-indigo-600 hover:text-indigo-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Return to menu
          </Link>
        </div>
      </div>
    )
  }

  const returnUrl = `/checkout/${order.id}/confirmation`

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        {/* Back link */}
        <Link
          href={`/menu/${order.tenants.slug}`}
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to menu
        </Link>

        {/* Order summary */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900 flex items-center">
              <ShoppingBag className="w-5 h-5 mr-2" />
              Checkout
            </h1>
            <span className="text-sm text-gray-500">{order.tenants.name}</span>
          </div>

          {/* Order items */}
          <div className="border-t border-gray-200 pt-4">
            {order.order_items?.map((item: Record<string, unknown>) => (
              <div key={item.id as string} className="flex justify-between py-2">
                <div>
                  <span className="text-gray-900">
                    {item.quantity as number}x {(item.product_name as string) || 'Item'}
                  </span>
                  {item.selected_options && typeof item.selected_options === 'object' && Object.keys(item.selected_options as object).length > 0 ? (
                    <p className="text-sm text-gray-500">
                      {Object.entries(item.selected_options as Record<string, unknown>)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ')}
                    </p>
                  ) : null}
                </div>
                <span className="text-gray-900 font-medium">
                  R$ {((item.unit_price as number) || 0).toFixed(2).replace('.', ',')}
                </span>
              </div>
            ))}
          </div>

          {/* Order total */}
          <div className="border-t border-gray-200 mt-4 pt-4 flex justify-between items-center">
            <span className="text-lg font-bold text-gray-900">Total</span>
            <span className="text-lg font-bold text-indigo-600">
              R$ {(order.total_cents / 100).toFixed(2).replace('.', ',')}
            </span>
          </div>
        </div>

        {/* Payment form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Details</h2>
          <StripeProvider clientSecret={clientSecret}>
            <CheckoutForm orderId={order.id} returnUrl={returnUrl} />
          </StripeProvider>
        </div>

        {/* Security note */}
        <p className="text-xs text-gray-500 text-center mt-4">
          Secured by Stripe. Your payment information is encrypted.
        </p>
      </div>
    </div>
  )
}