import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { revalidatePath } from 'next/cache'
import { enqueueXphereSync } from '@/lib/xphere/queue'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'
import { reconcileTenantSettings } from '@/lib/tenant-plan'
import { getLiveStripeSubscription, PlanChangeError, swapStripeSubscriptionPlan } from '@/lib/plan-billing'

const SUBSCRIPTION_STATUSES = ['active', 'trial', 'past_due', 'cancelled'] as const
type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

interface RouteParams {
  params: Promise<{ id: string }>
}

async function handleGET(request: Request, { params }: RouteParams) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: tenantId } = await params
  const service = await createServiceClient()

  // Fetch tenant subscription with plan details
  const { data: subscription, error: subError } = await service
    .from('tenant_subscriptions')
    .select('*, plan:plans(*)')
    .eq('tenant_id', tenantId)
    .single()

  if (subError && subError.code !== 'PGRST116') {
    log.error('Failed to fetch subscription', { err: subError })
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 })
  }

  // If no subscription exists, create a default response
  if (!subscription) {
    return NextResponse.json({
      id: null,
      tenant_id: tenantId,
      plan_id: null,
      billing_cycle: 'monthly',
      status: 'active',
      override_monthly_price: null,
      override_annual_price: null,
      override_transaction_fee_pct: null,
      override_notes: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      plan: null,
    })
  }

  return NextResponse.json(subscription)
}

async function handlePUT(request: Request, { params }: RouteParams) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: tenantId } = await params
  const service = await createServiceClient()

  let body: {
    plan_id?: string
    billing_cycle?: 'monthly' | 'annual'
    status?: SubscriptionStatus
    override_monthly_price?: number | null
    override_annual_price?: number | null
    override_transaction_fee_pct?: number | null
    override_notes?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { plan_id, billing_cycle, status, override_monthly_price, override_annual_price, override_transaction_fee_pct, override_notes } = body

  // Validation
  if (status !== undefined && !SUBSCRIPTION_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Status must be active, trial, past_due or cancelled' }, { status: 400 })
  }
  if (billing_cycle !== undefined && billing_cycle !== 'monthly' && billing_cycle !== 'annual') {
    return NextResponse.json({ error: 'Billing cycle must be monthly or annual' }, { status: 400 })
  }

  if (override_monthly_price !== null && override_monthly_price !== undefined && override_monthly_price < 0) {
    return NextResponse.json({ error: 'Override monthly price must be non-negative' }, { status: 400 })
  }

  if (override_annual_price !== null && override_annual_price !== undefined && override_annual_price < 0) {
    return NextResponse.json({ error: 'Override annual price must be non-negative' }, { status: 400 })
  }

  if (override_transaction_fee_pct !== null && override_transaction_fee_pct !== undefined && (override_transaction_fee_pct < 0 || override_transaction_fee_pct > 100)) {
    return NextResponse.json({ error: 'Override transaction fee must be between 0 and 100' }, { status: 400 })
  }

  // Check if subscription exists
  const { data: existing } = await service
    .from('tenant_subscriptions')
    .select('id, plan_id, billing_cycle, status, stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { data: selectedPlan } = plan_id
    ? await service
        .from('plans')
        .select('id, slug, stripe_price_monthly_id, stripe_price_annual_id')
        .eq('id', plan_id)
        .eq('is_active', true)
        .maybeSingle()
    : { data: null }
  if (plan_id && !selectedPlan) {
    return NextResponse.json({ error: 'Selected plan was not found or is inactive' }, { status: 400 })
  }

  const warnings: string[] = []

  // A restaurant billed through Stripe: the plan and cycle it pays for live on
  // the Stripe subscription, so a change made here swaps the Stripe price too
  // (prorated). Otherwise the next Stripe webhook would put the old plan back.
  const planChanged = Boolean(existing && plan_id !== undefined && plan_id !== existing.plan_id)
  const cycleChanged = Boolean(existing && billing_cycle !== undefined && billing_cycle !== existing.billing_cycle)
  if (existing?.stripe_subscription_id) {
    let liveSubscription
    try {
      liveSubscription = await getLiveStripeSubscription(existing.stripe_subscription_id)
    } catch (error) {
      log.error('Failed to read Stripe subscription', { err: error, tenant_id: tenantId })
      return NextResponse.json({ error: 'Could not reach Stripe. Nothing was changed.' }, { status: 502 })
    }

    if (liveSubscription && (planChanged || cycleChanged)) {
      const targetPlan = selectedPlan ?? (await service
        .from('plans')
        .select('id, slug, stripe_price_monthly_id, stripe_price_annual_id')
        .eq('id', existing.plan_id)
        .maybeSingle()).data
      if (!targetPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      try {
        await swapStripeSubscriptionPlan({
          subscription: liveSubscription,
          tenantId,
          plan: targetPlan,
          cycle: billing_cycle ?? existing.billing_cycle,
        })
      } catch (error) {
        if (error instanceof PlanChangeError) {
          return NextResponse.json({ error: `${error.message} Nothing was changed.` }, { status: error.status })
        }
        throw error
      }
    }

    if (liveSubscription && status !== undefined && status !== existing.status) {
      warnings.push('This restaurant is still billed through Stripe: the status set here is overwritten by the next Stripe event. Cancel or pause the subscription in Stripe to make it stick.')
    }
  }

  const updateData: Record<string, unknown> = {}

  if (plan_id !== undefined) {
    updateData.plan_id = plan_id
  }

  if (billing_cycle !== undefined) {
    updateData.billing_cycle = billing_cycle
  }

  if (status !== undefined) {
    updateData.status = status
  }

  if (override_monthly_price !== undefined) {
    updateData.override_monthly_price = override_monthly_price
  }

  if (override_annual_price !== undefined) {
    updateData.override_annual_price = override_annual_price
  }

  if (override_transaction_fee_pct !== undefined) {
    updateData.override_transaction_fee_pct = override_transaction_fee_pct
  }

  if (override_notes !== undefined) {
    updateData.override_notes = override_notes
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  let data, error

  if (existing) {
    // Update existing subscription
    const result = await service
      .from('tenant_subscriptions')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .select('*, plan:plans(*)')
      .single()
    data = result.data
    error = result.error
  } else {
    if (!plan_id) {
      return NextResponse.json(
        { error: 'Select a plan before editing billing details.' },
        { status: 400 }
      )
    }
    const result = await service
      .from('tenant_subscriptions')
      .insert({
        tenant_id: tenantId,
        plan_id,
        billing_cycle: billing_cycle ?? 'monthly',
        status: status ?? 'active',
        override_monthly_price: override_monthly_price ?? null,
        override_annual_price: override_annual_price ?? null,
        override_transaction_fee_pct: override_transaction_fee_pct ?? null,
        override_notes: override_notes ?? null,
      })
      .select('*, plan:plans(*)')
      .single()
    data = result.data
    error = result.error
  }

  if (error) {
    log.error('Failed to update subscription', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // The plan or status may have just dropped: switch off what the new
  // ceiling no longer allows (stripe_connections and tables stay untouched).
  const reconciled = await reconcileTenantSettings(tenantId, service)
  if (!reconciled.ok) {
    log.error('Failed to reconcile settings with plan', { err: reconciled.error, tenant_id: tenantId })
    warnings.push('The plan was saved, but the restaurant switches could not be adjusted to it. Review them in Service switches.')
  }

  // tenants.plan follows plan_id through the mirror_tenant_plan trigger.
  const { data: tenant } = await service.from('tenants').select('slug').eq('id', tenantId).maybeSingle()
  revalidatePath('/tenants')
  if (tenant?.slug) revalidatePath(`/${tenant.slug}`, 'layout')
  await enqueueXphereSync(tenantId, existing ? 'plan_changed' : 'plan_activated')

  return NextResponse.json(warnings.length ? { ...data, warning: warnings.join(' ') } : data)
}

export const GET = withApi('GET /api/superadmin/tenants/[id]/subscription', handleGET)
export const PUT = withApi('PUT /api/superadmin/tenants/[id]/subscription', handlePUT)
