import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface OrderItem {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  notes?: string
}

interface CreateOrderRequest {
  tenant_id: string
  customer_name: string
  customer_phone: string
  items: OrderItem[]
}

export async function POST(request: Request) {
  try {
    const body: CreateOrderRequest = await request.json()
    const { tenant_id, customer_name, customer_phone, items } = body

    if (!tenant_id?.trim()) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }
    if (!customer_name?.trim()) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
    }
    if (!customer_phone?.trim()) {
      return NextResponse.json({ error: 'Customer phone is required' }, { status: 400 })
    }
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }

    const service = await createServiceClient()

    const total = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)

    const { data: order, error: orderError } = await service
      .from('orders')
      .insert({
        tenant_id,
        customer_name: customer_name.trim(),
        customer_phone: customer_phone.trim(),
        status: 'pending',
        total,
      })
      .select()
      .single()

    if (orderError || !order) {
      console.error('orders.create_error', orderError)
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }

    const orderItems = items.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      notes: item.notes || null,
    }))

    const { error: itemsError } = await service
      .from('order_items')
      .insert(orderItems)

    if (itemsError) {
      console.error('orders.items_create_error', itemsError)
      await service.from('orders').delete().eq('id', order.id)
      return NextResponse.json({ error: 'Failed to create order items' }, { status: 500 })
    }

    return NextResponse.json({ id: order.id, status: order.status, total: order.total })
  } catch (error) {
    console.error('orders.error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const tenantId = searchParams.get('tenant_id')

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    const service = await createServiceClient()

    const { data: orders, error: ordersError } = await service
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (ordersError) {
      console.error('orders.fetch_error', ordersError)
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
    }

    return NextResponse.json({ orders: orders ?? [] })
  } catch (error) {
    console.error('orders.fetch_error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}