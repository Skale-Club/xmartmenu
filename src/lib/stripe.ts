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

// Stripe charges in the smallest currency unit. For most currencies (BRL, USD,
// EUR, GBP…) that is 1/100 of the major unit; a set of "zero-decimal" currencies
// (JPY, KRW…) have no minor unit and must NOT be multiplied by 100, otherwise
// every charge is 100x too large. Orders store `total` as a NUMERIC major-unit
// amount, so every Stripe amount goes through this single conversion point.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
])

export function currencyMinorFactor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 1 : 100
}

// Convert a major-unit amount (e.g. 19.99) into Stripe's smallest unit for the
// given currency. Math.round avoids float drift (e.g. 19.99 * 100).
export function toStripeAmount(major: number, currency: string): number {
  return Math.round(Number(major) * currencyMinorFactor(currency))
}

// Resolve a tenant's configured currency (menu prices are already rendered in
// this currency, so the PaymentIntent MUST match it). Defaults to USD to align
// with the English-first product default; falls back gracefully if unset.
export async function getTenantCurrency(tenantId: string, client?: SupabaseClient): Promise<string> {
  const supabase = client ?? createServiceClient()
  const { data } = await supabase
    .from('tenant_settings')
    .select('currency')
    .eq('tenant_id', tenantId)
    .single()
  const c = (data?.currency ?? 'usd').toString().toLowerCase()
  return c || 'usd'
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
 * @param params.amountDollars - Order total in MAJOR currency units (e.g. 19.99)
 * @param params.tipCents - Tip in 1/100 major units (order.tip_cents), fee-exempt
 * @param params.currency - Currency override; defaults to the tenant's currency
 * @returns { clientSecret, paymentIntentId }
 */
export async function createPaymentIntent(params: {
  tenantId: string
  orderId: string
  amountDollars: number
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

  // Resolve the tenant's currency (charge MUST match the currency the menu was
  // priced/displayed in) and convert amounts into Stripe's smallest unit.
  const currency = (params.currency ?? await getTenantCurrency(params.tenantId, supabase)).toLowerCase()
  const factor = currencyMinorFactor(currency)
  const amount = toStripeAmount(params.amountDollars, currency)
  // tip_cents is stored as 1/100 of the major unit; convert to the charge's
  // minor unit so the fee-exempt tip lines up even for zero-decimal currencies.
  const tipMinor = Math.round(((params.tipCents ?? 0) / 100) * factor)

  // Use `?? 0.005` (not `|| 0.005`): a legitimately overridden 0% fee must be
  // honored — `0 || 0.005` would silently bill a "0% transaction fee" tenant.
  const feePct = plan.transaction_fee_pct ?? 0.005
  const feeableAmount = amount - tipMinor
  const applicationFeeAmount = Math.floor(Math.max(0, feeableAmount) * feePct)

  // 3. Create PaymentIntent on tenant's connected account
  // automatic_payment_methods enables Apple Pay, Google Pay, and other wallets
  // automatically based on device/browser — no manual listing required.
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
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
  amountDollars: number
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

  const existingId: string | null = order?.payment_intent_id ?? null
  if (existingId) {
    // Reuse the existing PaymentIntent unless it was cancelled (then fall
    // through and mint a fresh one to replace it).
    const paymentIntent = await stripe.paymentIntents.retrieve(existingId)
    if (paymentIntent.status !== 'canceled') {
      return {
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
      }
    }
  }

  // Create a new PaymentIntent, then atomically CLAIM it on the order by only
  // writing when payment_intent_id still holds the value we read (null, or the
  // cancelled id we're replacing). Two concurrent checkout loads would otherwise
  // both create a chargeable intent (and the customer could pay twice). The
  // loser cancels its now-orphan intent and reuses the winner's.
  const result = await createPaymentIntent(params)
  const claimQuery = supabase
    .from('orders')
    .update({ payment_intent_id: result.paymentIntentId })
    .eq('id', params.orderId)
  const { data: claimed } = await (existingId
    ? claimQuery.eq('payment_intent_id', existingId)
    : claimQuery.is('payment_intent_id', null)
  ).select('id').maybeSingle()

  if (!claimed) {
    // Another request won the claim (or a cancelled intent is being replaced).
    // Cancel ours so there is never a second confirmable intent for one order.
    try { await stripe.paymentIntents.cancel(result.paymentIntentId) } catch { /* best-effort */ }
    const { data: winner } = await supabase
      .from('orders')
      .select('payment_intent_id')
      .eq('id', params.orderId)
      .single()
    if (winner?.payment_intent_id && winner.payment_intent_id !== result.paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(winner.payment_intent_id)
      return { clientSecret: pi.client_secret!, paymentIntentId: pi.id }
    }
  }
  return result
}
