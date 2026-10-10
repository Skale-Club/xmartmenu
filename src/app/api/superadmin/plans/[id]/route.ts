import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Failed to fetch plan:', error)
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function PUT(request: Request, { params }: RouteParams) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const supabase = await createServiceClient()

  let body: Record<string, unknown>

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = body.name as string
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    updateData.name = name.trim()
    updateData.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  if (body.description !== undefined) {
    updateData.description = body.description
  }

  if (body.monthly_price !== undefined) {
    const monthly_price = body.monthly_price as number
    if (monthly_price < 0) {
      return NextResponse.json({ error: 'Monthly price must be non-negative' }, { status: 400 })
    }
    updateData.monthly_price = monthly_price
  }

  if (body.annual_price !== undefined) {
    const annual_price = body.annual_price as number
    if (annual_price < 0) {
      return NextResponse.json({ error: 'Annual price must be non-negative' }, { status: 400 })
    }
    updateData.annual_price = annual_price
  }

  if (body.transaction_fee_pct !== undefined) {
    const transaction_fee_pct = body.transaction_fee_pct as number
    if (transaction_fee_pct < 0 || transaction_fee_pct > 100) {
      return NextResponse.json({ error: 'Transaction fee must be between 0 and 100' }, { status: 400 })
    }
    updateData.transaction_fee_pct = transaction_fee_pct
  }

  if (body.features !== undefined) {
    if (!Array.isArray(body.features)) {
      return NextResponse.json({ error: 'Features must be an array' }, { status: 400 })
    }
    updateData.features = body.features
  }

  if (body.is_active !== undefined) {
    updateData.is_active = body.is_active
  }

  if (body.sort_order !== undefined) {
    updateData.sort_order = body.sort_order
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('plans')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update plan:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request, { params }: RouteParams) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const supabase = await createServiceClient()

  // Check if any tenants are on this plan
  const { data: subscriptions } = await supabase
    .from('tenant_subscriptions')
    .select('tenant_id')
    .eq('plan_id', id)
    .limit(1)

  if (subscriptions && subscriptions.length > 0) {
    return NextResponse.json(
      { error: 'Cannot delete plan with active tenants. Remove tenants first.' },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from('plans')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Failed to delete plan:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}