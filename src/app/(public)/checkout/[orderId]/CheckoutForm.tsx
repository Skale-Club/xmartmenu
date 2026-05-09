'use client'

/**
 * CheckoutForm.tsx
 * 
 * Client component for Stripe Payment Element form.
 * Phase 33: Payment Intent + Webhook
 */

import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { useState, type FormEvent } from 'react'

interface CheckoutFormProps {
  orderId: string
  returnUrl: string
}

export function CheckoutForm({ orderId, returnUrl }: CheckoutFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    
    if (!stripe || !elements) {
      return
    }

    setProcessing(true)
    setError(null)

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
    const fullReturnUrl = `${baseUrl}${returnUrl}`

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: fullReturnUrl,
      },
    })

    if (stripeError) {
      setError(stripeError.message || 'Payment failed. Please try again.')
      setProcessing(false)
    }
    // If successful, Stripe redirects automatically
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-6">
        <PaymentElement />
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full bg-[#635BFF] hover:bg-[#5851E1] text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {processing ? 'Processing...' : 'Pay Now'}
      </button>
    </form>
  )
}