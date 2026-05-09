/**
 * Tenant Subscription API
 * 
 * Phase 34: Tenant Subscription UI
 * GET: Returns subscription, plan, features, Stripe status
 * PATCH: Updates billing_cycle (monthly/annual)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantPlan } from '@/lib/tenant-plan'
import { isStripeEnabled } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const BillingCycleSchema = z.enum(['monthly', 'annual'])

/**
 * GET /api/tenant/subscription
 * Returns subscription details with effective plan and Stripe status
 */
export async function GET() {
  try {
    const effective = await getEffectiveTenant()
    if (!effective) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { tenantId } = effective
    const supabase = await createClient()

    // Get subscription directly from DB
    const { data: subscription, error: subError } = await supabase
      .from('tenant_subscriptions')
      .select('*')
      .eq('tenant_id', tenantId)
      .single()

    if (subError || !subscription) {
      // No subscription - return null state
      return NextResponse.json({
        subscription: null,
        plan: null,
        features: [],
        stripeEnabled: false,
        stripeAccountId: null,
      })
    }

    // Get effective plan (includes resolved overrides)
    const plan = await getTenantPlan(tenantId)
    const stripeEnabledResult = await isStripeEnabled(tenantId)

    // Get Stripe account ID if connected
    let stripeAccountId: string | null = null
    if (stripeEnabledResult) {
      const { data: stripeConn } = await supabase
        .from('stripe_connections')
        .select('stripe_account_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single()
      stripeAccountId = stripeConn?.stripe_account_id ?? null
    }

    return NextResponse.json({
      subscription: {
        id: subscription.id,
        billing_cycle: subscription.billing_cycle,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
      plan,
      features: plan?.features ?? [],
      stripeEnabled: stripeEnabledResult,
      stripeAccountId,
    })
  } catch (error) {
    console.error('GET /api/tenant/subscription error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/tenant/subscription
 * Updates billing_cycle preference
 */
export async function PATCH(request: NextRequest) {
  try {
    const effective = await getEffectiveTenant()
    if (!effective) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { tenantId } = effective

    // Parse and validate request body
    const body = await request.json()
    const result = BillingCycleSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid billing_cycle value' },
        { status: 400 }
      )
    }

    const { billing_cycle } = result.data
    const supabase = await createClient()

    // Update billing cycle
    const { data: subscription, error: updateError } = await supabase
      .from('tenant_subscriptions')
      .update({ billing_cycle })
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to update billing cycle:', updateError)
      return NextResponse.json(
        { error: 'Failed to update billing cycle' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      subscription: {
        billing_cycle: subscription.billing_cycle,
      },
    })
  } catch (error) {
    console.error('PATCH /api/tenant/subscription error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}