import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { revalidatePath } from 'next/cache'
import { enqueueXphereSync } from '@/lib/xphere/queue'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
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
    console.error('Failed to fetch subscription:', subError)
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

export async function PUT(request: Request, { params }: RouteParams) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: tenantId } = await params
  const service = await createServiceClient()

  let body: {
    plan_id?: string
    billing_cycle?: 'monthly' | 'annual'
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

  const { plan_id, billing_cycle, override_monthly_price, override_annual_price, override_transaction_fee_pct, override_notes } = body

  // Validation
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
    .select('id, plan_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { data: selectedPlan } = plan_id
    ? await service.from('plans').select('id, slug').eq('id', plan_id).eq('is_active', true).maybeSingle()
    : { data: null }
  if (plan_id && !selectedPlan) {
    return NextResponse.json({ error: 'Selected plan was not found or is inactive' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {}

  if (plan_id !== undefined) {
    updateData.plan_id = plan_id
  }

  if (billing_cycle !== undefined) {
    updateData.billing_cycle = billing_cycle
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
        status: 'active',
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
    console.error('Failed to update subscription:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (selectedPlan) {
    await service.from('tenants').update({ plan: selectedPlan.slug }).eq('id', tenantId)
  }
  const { data: tenant } = await service.from('tenants').select('slug').eq('id', tenantId).maybeSingle()
  revalidatePath('/tenants')
  if (tenant?.slug) revalidatePath(`/${tenant.slug}`, 'layout')
  await enqueueXphereSync(tenantId, existing ? 'plan_changed' : 'plan_activated')

  return NextResponse.json(data)
}
