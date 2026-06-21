/**
 * stripe.ts - Stripe client initialization and helpers
 *
 * Phase 32: Stripe Connect OAuth
 * Initializes Stripe SDK and provides feature-gate helpers.
 */

import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'

let stripeClient: Stripe | null = null

function getStripeClient() {
  if (stripeClient) return stripeClient

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required to use Stripe features')
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: '2026-04-22.dahlia',
  })
  return stripeClient
}

const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    return Reflect.get(getStripeClient(), prop, receiver)
  },
})

export { stripe }

// Stripe charges in the smallest currency unit (cents for BRL/USD). Orders
// store `total` as NUMERIC dollars, so every Stripe amount must go through this
// single conversion point. Math.round avoids float drift (e.g. 19.99 * 100).
export const STRIPE_MIN_AMOUNT_CENTS = 50 // ~R$0.50 minimum charge for BRL

export function toStripeAmount(dollars: number): number {
  return Math.round(Number(dollars) * 100)
}

// Types for Stripe connection records
export interface StripeConnection {
  id: string
  tenant_id: string
  stripe_account_id: string
  scope: string
  connected_at: string
  is_active: boolean
  disconnected_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Feature gate: check if tenant can use Stripe payments
 *
 * A tenant is "Stripe enabled" when:
 * 1. They are on a plan that includes 'stripe-connect' feature
 * 2. They have an active Stripe connection record
 *
 * @param tenantId - The tenant UUID
 * @param client - Optional Supabase client (defaults to service-role client so
 *   it works in anonymous/server contexts such as public checkout)
 * @returns true if Stripe payments are available and configured
 */
export async function isStripeEnabled(tenantId: string, client?: SupabaseClient): Promise<boolean> {
  const supabase = client ?? createServiceClient()
  const plan = await getTenantPlan(tenantId, supabase)

  if (!plan) return false
  if (!plan.features.includes('stripe-connect')) return false

  // Check for active Stripe connection
  const { data } = await supabase
    .from('stripe_connections')
    .select('stripe_account_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()

  return !!data
}

/**
 * Get the Stripe connection record for a tenant
 *
 * @param tenantId - The tenant UUID
 * @param client - Optional Supabase client (defaults to service-role client)
 * @returns StripeConnection or null if not connected
 */
export async function getStripeConnection(tenantId: string, client?: SupabaseClient): Promise<StripeConnection | null> {
  const supabase = client ?? createServiceClient()
  const { data } = await supabase
    .from('stripe_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()
  return data
}

/**
 * Check if a tenant's plan includes Stripe Connect feature
 *
 * @param tenantId - The tenant UUID
 * @param client - Optional Supabase client (defaults to service-role client)
 * @returns true if plan includes stripe-connect feature
 */
export async function hasStripeConnectFeature(tenantId: string, client?: SupabaseClient): Promise<boolean> {
  const plan = await getTenantPlan(tenantId, client ?? createServiceClient())
  if (!plan) return false
  return plan.features.includes('stripe-connect')
}

// Types for PaymentIntent operations
export interface PaymentIntentResult {
  clientSecret: string
  paymentIntentId: string
}

/**
 * Create a PaymentIntent for an order with Stripe Connect routing
 *
 * @param params.tenantId - The tenant UUID
 * @param params.orderId - The order UUID
 * @param params.amount - Amount in cents (smallest currency unit)
 * @param params.currency - Currency code (default: 'brl')
 * @returns { clientSecret, paymentIntentId }
 */
export async function createPaymentIntent(params: {
  tenantId: string
  orderId: string
  amount: number
  tipCents?: number
  currency?: string
}): Promise<PaymentIntentResult> {
  const supabase = createServiceClient()

  // 1. Get tenant's Stripe connection
  const { data: connection } = await supabase
    .from('stripe_connections')
    .select('stripe_account_id')
    .eq('tenant_id', params.tenantId)
    .eq('is_active', true)
    .single()

  if (!connection) {
    throw new Error('No active Stripe connection for tenant')
  }

  // 2. Get transaction fee from plan
  const plan = await getTenantPlan(params.tenantId, supabase)
  if (!plan || !plan.features.includes('payments')) {
    throw new Error('Payments not available on current plan')
  }

  const feePct = plan.transaction_fee_pct || 0.005
  const feeableAmount = params.amount - (params.tipCents ?? 0)
  const applicationFeeAmount = Math.floor(Math.max(0, feeableAmount) * feePct)

  // 3. Create PaymentIntent on tenant's connected account
  // automatic_payment_methods enables Apple Pay, Google Pay, and other wallets
  // automatically based on device/browser — no manual listing required.
  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.amount,
    currency: params.currency || 'brl',
    application_fee_amount: applicationFeeAmount,
    automatic_payment_methods: { enabled: true },
    transfer_data: {
      destination: connection.stripe_account_id,
    },
    metadata: {
      order_id: params.orderId,
      tenant_id: params.tenantId,
    },
  })

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  }
}

/**
 * Get or create PaymentIntent for an order
 *
 * If an order already has a payment_intent_id, return the existing client secret.
 * Otherwise, create a new PaymentIntent.
 *
 * @param params - Same as createPaymentIntent
 * @returns { clientSecret, paymentIntentId }
 */
export async function getOrCreatePaymentIntent(params: {
  tenantId: string
  orderId: string
  amount: number
  tipCents?: number
  currency?: string
}): Promise<PaymentIntentResult> {
  const supabase = createServiceClient()

  // Check if order already has a payment intent
  const { data: order } = await supabase
    .from('orders')
    .select('payment_intent_id')
    .eq('id', params.orderId)
    .single()

  if (order?.payment_intent_id) {
    // Retrieve the existing PaymentIntent to get client secret
    const paymentIntent = await stripe.paymentIntents.retrieve(order.payment_intent_id)
    return {
      clientSecret: paymentIntent.client_secret!,
      paymentIntentId: paymentIntent.id,
    }
  }

  // Create a new PaymentIntent and persist its id, so reloading the checkout
  // page reuses the same intent instead of creating a fresh one each render.
  const result = await createPaymentIntent(params)
  await supabase
    .from('orders')
    .update({ payment_intent_id: result.paymentIntentId })
    .eq('id', params.orderId)
  return result
}
