/**
 * Checkout confirmation page
 * Phase 33: Payment Intent + Webhook
 * 
 * Displays payment result after Stripe redirect.
 * Relies on webhook to update order status in DB.
 */

import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { CheckCircle, XCircle, ArrowLeft, Loader2 } from 'lucide-react'

interface ConfirmationPageProps {
  params: Promise<{ orderId: string }>
  searchParams: Promise<{ 
    payment_intent?: string
    payment_intent_client_secret?: string
    redirect_status?: string
  }>
}

export default async function ConfirmationPage({ 
  params,
  searchParams 
}: ConfirmationPageProps) {
  const { orderId } = await params
  const { payment_intent, redirect_status } = await searchParams
  // Anonymous customer context — read the order by its unguessable UUID via the
  // service client (RLS on `orders` is admin/staff-only). See checkout page.
  const supabase = createServiceClient()

  // If we have redirect_status from Stripe, show the appropriate message
  if (redirect_status) {
    if (redirect_status === 'succeeded') {
      // Fetch the order to show details
      const { data: order } = await supabase
        .from('orders')
        .select('*, tenants(slug, name)')
        .eq('id', orderId)
        .single()

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h1>
            <p className="text-gray-600 mb-6">
              Your order has been confirmed and is being processed.
            </p>
            
            {order && (
              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-gray-500 mb-2">Order Details</p>
                <p className="font-semibold text-gray-900">{order.tenants?.name}</p>
                <p className="text-sm text-gray-600">
                  Total: R$ {Number(order.total).toFixed(2).replace('.', ',')}
                </p>
                <p className="text-xs text-gray-400 mt-2">Order ID: {order.id.slice(0, 8)}...</p>
              </div>
            )}

            <div className="space-y-3">
              {order?.tenants?.slug && (
                <Link
                  href={`/${order.tenants.slug}`}
                  className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                >
                  Return to Menu
                </Link>
              )}
            </div>
          </div>
        </div>
      )
    }

    if (redirect_status === 'failed') {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
            <div className="flex justify-center mb-4">
              <XCircle className="w-16 h-16 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h1>
            <p className="text-gray-600 mb-6">
              Your payment could not be processed. Please try again or use a different payment method.
            </p>

            <div className="space-y-3">
              <Link
                href={`/checkout/${orderId}`}
                className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                Try Again
              </Link>
              <Link
                href="/"
                className="block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                Return to Home
              </Link>
            </div>
          </div>
        </div>
      )
    }
  }

  // If no redirect_status, check the order status in the database
  // (webhook should have updated it)
  const { data: order } = await supabase
    .from('orders')
    .select('*, tenants(slug, name)')
    .eq('id', orderId)
    .single()

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Order Not Found</h1>
          <Link
            href="/"
            className="text-indigo-600 hover:text-indigo-700"
          >
            Return to Home
          </Link>
        </div>
      </div>
    )
  }

  // Show order status (could be pending if webhook hasn't processed yet)
  const isPaid = order.status === 'paid'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        {isPaid ? (
          <>
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Confirmed!</h1>
            <p className="text-gray-600 mb-6">
              Your payment has been processed successfully.
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-4">
              <Loader2 className="w-16 h-16 text-yellow-500 animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Processing Payment</h1>
            <p className="text-gray-600 mb-6">
              We're verifying your payment. This may take a moment.
            </p>
          </>
        )}

        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
          <p className="text-sm text-gray-500 mb-2">Order Details</p>
          <p className="font-semibold text-gray-900">{order.tenants?.name}</p>
          <p className="text-sm text-gray-600">
            Total: R$ {Number(order.total ?? 0).toFixed(2).replace('.', ',')}
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Status: {order.status}
          </p>
        </div>

        <div className="space-y-3">
          {order.tenants?.slug && (
            <Link
              href={`/${order.tenants.slug}`}
              className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Return to Menu
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}