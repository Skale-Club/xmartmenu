/**
 * stripe.ts - Stripe client initialization and helpers
 * 
 * Phase 32: Stripe Connect OAuth
 * Initializes Stripe SDK and provides feature-gate helpers.
 */

import Stripe from 'stripe'

// Initialize Stripe client with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
})

export { stripe }

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
 * @returns true if Stripe payments are available and configured
 */
export async function isStripeEnabled(tenantId: string): Promise<boolean> {
  const { getTenantPlan } = await import('@/lib/tenant-plan')
  const plan = await getTenantPlan(tenantId)
  
  if (!plan) return false
  if (!plan.features.includes('stripe-connect')) return false
  
  // Check for active Stripe connection
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
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
 * @returns StripeConnection or null if not connected
 */
export async function getStripeConnection(tenantId: string): Promise<StripeConnection | null> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
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
 * @returns true if plan includes stripe-connect feature
 */
export async function hasStripeConnectFeature(tenantId: string): Promise<boolean> {
  const { getTenantPlan } = await import('@/lib/tenant-plan')
  const plan = await getTenantPlan(tenantId)
  if (!plan) return false
  return plan.features.includes('stripe-connect')
}