/**
 * Subscription Page - Server Component
 * 
 * Phase 34: Tenant Subscription UI
 * Displays subscription details, features, and Stripe connection status.
 */

import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantPlan } from '@/lib/tenant-plan'
import { isStripeEnabled } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import SubscriptionClient from './SubscriptionClient'

export default async function SubscriptionPage() {
  const effective = await getEffectiveTenant()

  // Redirect if not authenticated
  if (!effective) {
    return (
      <div className="p-8">
        <p className="text-zinc-500">Please sign in to view your subscription.</p>
      </div>
    )
  }

  const { tenantId } = effective
  const supabase = await createClient()

  // Fetch subscription from DB
  const { data: subscription } = await supabase
    .from('tenant_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .single()

  // Get effective plan (includes resolved overrides)
  const plan = await getTenantPlan(tenantId)
  const stripeEnabled = await isStripeEnabled(tenantId)

  // Get Stripe account ID if connected
  let stripeAccountId: string | null = null
  if (stripeEnabled) {
    const { data: stripeConn } = await supabase
      .from('stripe_connections')
      .select('stripe_account_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single()
    stripeAccountId = stripeConn?.stripe_account_id ?? null
  }

  return (
    <SubscriptionClient
      tenantId={tenantId}
      subscription={subscription}
      plan={plan}
      stripeEnabled={stripeEnabled}
      stripeAccountId={stripeAccountId}
    />
  )
}