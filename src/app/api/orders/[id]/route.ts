import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { NextResponse } from 'next/server'

const VALID_STATUSES = [
  'pending', 'paid', 'payment_failed', 'preparing', 'ready', 'done', 'cancelled',
] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // P0-06 fix: require authenticated tenant user, verify order belongs to
    // that tenant, take id from URL not body.
    const effective = await getEffectiveTenant()
    if (!effective) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (effective.role === 'customer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: orderId } = await params
    if (!orderId?.trim()) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    const body = await request.json()
    const { status } = body

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const service = await createServiceClient()

    // Verify the order belongs to the effective tenant before mutating
    const { data: existing, error: existingError } = await service
      .from('orders')
      .select('id, tenant_id')
      .eq('id', orderId)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (existing.tenant_id !== effective.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: order, error } = await service
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single()

    if (error || !order) {
      console.error('orders.update_error', error)
      return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
    }

    return NextResponse.json({ id: order.id, status: order.status })
  } catch (error) {
    console.error('orders.update_error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
