'use client'

/**
 * StripeProvider.tsx
 * 
 * Client-side wrapper for Stripe Elements initialization.
 * Phase 33: Payment Intent + Webhook
 */

import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { ReactNode, useMemo } from 'react'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export interface StripeProviderProps {
  children: ReactNode
  clientSecret: string
  primaryColor: string
  onPrimary: string
  focusColor: string
}

/**
 * StripeProvider wrapper component
 * 
 * Initializes Stripe Elements with the Payment Element configuration.
 * Uses Stripe's recommended styling with primary color accent.
 */
export function StripeProvider({ children, clientSecret, primaryColor, onPrimary, focusColor }: StripeProviderProps) {
  const options = useMemo(() => ({
    clientSecret,
    appearance: {
      theme: 'stripe' as const,
      variables: {
        colorPrimary: primaryColor,
        accessibleColorOnColorPrimary: onPrimary,
        colorBackground: '#ffffff',
        colorText: '#30313d',
        colorDanger: '#df1b41',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        spacingUnit: '4px',
        borderRadius: '4px',
      },
      rules: {
        '.Input:focus': { borderColor: focusColor, boxShadow: `0 0 0 2px ${focusColor}` },
        '.Tab:focus': { boxShadow: `0 0 0 2px ${focusColor}` },
      },
    },
  }), [clientSecret, primaryColor, onPrimary, focusColor])

  return (
    <Elements stripe={stripePromise} options={options}>
      {children}
    </Elements>
  )
}
