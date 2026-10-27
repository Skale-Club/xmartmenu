import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { NextResponse } from 'next/server'
import { recordTrustedOrderAnalyticsEvent } from '@/lib/analytics/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

import { canKitchenMove, isOrderStatus } from '@/lib/orders/status-machine'

async function handlePATCH(
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

    if (!isOrderStatus(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const service = await createServiceClient()

    const capabilities = await getTenantCapabilities(effective.tenantId, undefined, service)
    if (!capabilities.kds) {
      return NextResponse.json({ error: 'The kitchen display is part of the Menu + Orders plan' }, { status: 403 })
    }

    // Verify the order belongs to the effective tenant before mutating
    const { data: existing, error: existingError } = await service
      .from('orders')
      .select('id, tenant_id, status, order_type')
      .eq('id', orderId)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (existing.tenant_id !== effective.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Staff move orders through the kitchen; payment states (paid,
    // payment_failed, awaiting_payment) only come from the payment provider.
    if (existing.status === status) {
      return NextResponse.json({ id: existing.id, status: existing.status })
    }
    if (!canKitchenMove(existing.status, status, existing.order_type)) {
      return NextResponse.json({ error: `An order cannot go from ${existing.status} to ${status}` }, { status: 409 })
    }

    // Compare-and-set on the status we checked: a payment webhook or another
    // device that moved the order meanwhile is not overwritten.
    const { data: order, error } = await service
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', existing.status)
      .select()
      .maybeSingle()

    if (error) {
      log.error('orders.update_error', { err: error })
      return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
    }
    if (!order) {
      return NextResponse.json({ error: 'The order changed meanwhile, refresh and try again' }, { status: 409 })
    }

    if (status === 'done') {
      await recordTrustedOrderAnalyticsEvent(order.id, 'order_completed')
    } else if (status === 'cancelled') {
      await recordTrustedOrderAnalyticsEvent(order.id, 'order_cancelled')
    }

    return NextResponse.json({ id: order.id, status: order.status })
  } catch (error) {
    log.error('orders.update_error', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const PATCH = withApi('PATCH /api/orders/[id]', handlePATCH)
