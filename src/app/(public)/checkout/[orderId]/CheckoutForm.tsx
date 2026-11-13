'use client'

/**
 * CheckoutForm.tsx
 * 
 * Client component for Stripe Payment Element form.
 * Phase 33: Payment Intent + Webhook
 */

import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { useState, type FormEvent } from 'react'
import { ui, ctaStyle } from '@/components/menu/menu-ui'

interface CheckoutFormProps {
  orderId: string
  returnUrl: string
  primaryColor: string
  onPrimary: string
}

export function CheckoutForm({ returnUrl, primaryColor, onPrimary }: CheckoutFormProps) {
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

    // Come back to the host the guest paid on: the restaurant's custom domain
    // serves /checkout too (src/lib/custom-domain-routing.ts), so a payment
    // started there no longer ends on the platform address.
    const fullReturnUrl = `${window.location.origin}${returnUrl}`

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
        className={`${ui.cta} h-12 w-full enabled:hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed`}
        style={ctaStyle(primaryColor, onPrimary)}
      >
        {processing ? 'Processing...' : 'Pay Now'}
      </button>
    </form>
  )
}
