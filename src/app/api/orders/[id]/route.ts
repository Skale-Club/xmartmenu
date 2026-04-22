import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { order_id, status } = body

    if (!order_id?.trim()) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const service = await createServiceClient()

    const { data: order, error: error } = await service
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', order_id)
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