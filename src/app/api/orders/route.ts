import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { IngredientModifications } from '@/types/database'

interface OrderItem {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  notes?: string
  selected_options?: Record<string, unknown>
  ingredient_modifications?: IngredientModifications | null  // INGR-09: ADD
}

interface CreateOrderRequest {
  tenant_id: string
  customer_name: string
  customer_phone: string
  items: OrderItem[]
}

function sanitizeNote(raw: string | undefined | null): string | null {
  if (!raw) return null
  // Strip control chars (0x00-0x08, 0x0B-0x1F, 0x7F) — preserve tab (0x09) and newline (0x0A)
  const stripped = raw.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
  const trimmed = stripped.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 140)
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

    // SEC-01: Validate tenant exists, is active, and has orders enabled
    const { data: tenantSettings, error: tenantError } = await service
      .from('tenants')
      .select('id, is_active, tenant_settings(orders_enabled)')
      .eq('id', tenant_id)
      .eq('is_active', true)
      .single()

    if (tenantError || !tenantSettings) {
      return NextResponse.json({ error: 'Invalid tenant' }, { status: 400 })
    }
    const settings = (tenantSettings.tenant_settings as any)
    if (!settings?.orders_enabled) {
      return NextResponse.json({ error: 'Orders not enabled for this tenant' }, { status: 403 })
    }

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
      notes: sanitizeNote(item.notes),
      selected_options: item.selected_options || null,
      ingredient_modifications: item.ingredient_modifications || null,  // INGR-09
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