import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
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
  const { id: tenantId } = await params
  const service = await createServiceClient()

  let body: {
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

  const { billing_cycle, override_monthly_price, override_annual_price, override_transaction_fee_pct, override_notes } = body

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
    .select('id')
    .eq('tenant_id', tenantId)
    .single()

  const updateData: Record<string, unknown> = {}

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
    // Need at least a plan_id to create subscription
    // Get any existing plan or return error
    const { data: tenantData } = await service
      .from('tenants')
      .select('plan')
      .eq('id', tenantId)
      .single()

    if (!tenantData?.plan) {
      return NextResponse.json({ error: 'Tenant has no plan. Please assign a plan first.' }, { status: 400 })
    }

    // Create new subscription
    const result = await service
      .from('tenant_subscriptions')
      .insert({
        tenant_id: tenantId,
        plan_id: tenantData.plan,
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}