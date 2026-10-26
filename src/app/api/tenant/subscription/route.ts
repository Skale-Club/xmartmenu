/**
 * Tenant Subscription API
 * 
 * Phase 34: Tenant Subscription UI
 * GET: Returns subscription, plan, features, Stripe status
 * PATCH: Updates billing_cycle (monthly/annual), owner only
 */

import { NextRequest, NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantPlan } from '@/lib/tenant-plan'
import { isStripeEnabled } from '@/lib/stripe'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getLiveStripeSubscription, PlanChangeError, swapStripeSubscriptionPlan } from '@/lib/plan-billing'
import { z } from 'zod'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

const BillingCycleSchema = z.object({
  billing_cycle: z.enum(['monthly', 'annual'])
})

/**
 * GET /api/tenant/subscription
 * Returns subscription details with effective plan and Stripe status
 */
async function handleGET() {
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
    log.error('GET /api/tenant/subscription error', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/tenant/subscription
 * Changes the billing cycle. Owner / superadmin only.
 *
 * tenant_subscriptions has SELECT policies only, so the write goes through the
 * service client (after the role check). A tenant billed through Stripe changes
 * cycle on the Stripe subscription (prorated price swap) and the
 * customer.subscription.updated webhook mirrors billing_cycle into the row
 * (answer: pending: true); a tenant without Stripe billing is updated directly.
 */
async function handlePATCH(request: NextRequest) {
  try {
    const effective = await getEffectiveTenant()
    if (!effective) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (effective.role !== 'store-admin' && effective.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { tenantId } = effective

    // Parse and validate request body
    const body = await request.json().catch(() => null)
    const result = BillingCycleSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid billing_cycle value' },
        { status: 400 }
      )
    }

    const { billing_cycle } = result.data
    const service = createServiceClient()

    const { data: current, error: currentError } = await service
      .from('tenant_subscriptions')
      .select('plan_id, billing_cycle, stripe_subscription_id')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (currentError) {
      log.error('Failed to read subscription for billing cycle change', { err: currentError })
      return NextResponse.json({ error: 'Failed to update billing cycle' }, { status: 500 })
    }
    if (!current) {
      return NextResponse.json({ error: 'No subscription to update' }, { status: 404 })
    }

    // Billed through Stripe: swap the price on the live subscription.
    if (current.stripe_subscription_id) {
      let liveSubscription
      try {
        liveSubscription = await getLiveStripeSubscription(current.stripe_subscription_id)
      } catch (error) {
        log.error('Failed to read Stripe subscription for billing cycle change', { err: error })
        return NextResponse.json({ error: 'Could not reach Stripe. Try again in a moment.' }, { status: 502 })
      }

      if (liveSubscription) {
        const { data: plan } = await service
          .from('plans')
          .select('id, stripe_price_monthly_id, stripe_price_annual_id')
          .eq('id', current.plan_id)
          .maybeSingle()
        if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

        try {
          await swapStripeSubscriptionPlan({ subscription: liveSubscription, tenantId, plan, cycle: billing_cycle })
        } catch (error) {
          if (error instanceof PlanChangeError) {
            return NextResponse.json({ error: error.message, portal: error.status === 409 }, { status: error.status })
          }
          throw error
        }
        return NextResponse.json({
          success: true,
          pending: true,
          subscription: { billing_cycle },
        })
      }
      // Ended Stripe subscription: nothing bills, so the preference is just a row value.
    }

    const { data: subscription, error: updateError } = await service
      .from('tenant_subscriptions')
      .update({ billing_cycle })
      .eq('tenant_id', tenantId)
      .select('billing_cycle')
      .single()

    if (updateError) {
      log.error('Failed to update billing cycle', { err: updateError })
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
    log.error('PATCH /api/tenant/subscription error', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = withApi('GET /api/tenant/subscription', handleGET)
export const PATCH = withApi('PATCH /api/tenant/subscription', handlePATCH)
