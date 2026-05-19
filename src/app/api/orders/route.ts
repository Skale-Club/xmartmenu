import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { NextResponse } from 'next/server'
import type { IngredientModifications } from '@/types/database'

interface OrderItem {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  notes?: string
  selected_options?: Record<string, unknown>
  ingredient_modifications?: IngredientModifications | null
}

interface CreateOrderRequest {
  tenant_id: string
  customer_name: string
  customer_phone: string
  items: OrderItem[]
  order_type?: string
  delivery_address?: string
  location_id?: string | null
  tip_cents?: number
  menu_id?: string | null
}

function sanitizeNote(raw: string | undefined | null): string | null {
  if (!raw) return null
  const stripped = raw.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
  const trimmed = stripped.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 140)
}

function computeItemUnitPrice(
  product: { price: number | null },
  item: OrderItem,
): number {
  // Server-side trusted unit price: base product price + sum of option
  // price_modifiers + sum of ingredient extras/adds. Client-supplied
  // unit_price is ignored — the client can only choose quantities and
  // which options/ingredients to apply.
  let unit = Number(product.price ?? 0)

  if (item.selected_options) {
    for (const v of Object.values(item.selected_options)) {
      if (v && typeof v === 'object' && 'price_modifier' in v) {
        unit += Number((v as { price_modifier?: number }).price_modifier ?? 0)
      } else if (v && typeof v === 'object' && 'base_price' in v) {
        // Absolute price options (single, half_and_half) replace base
        unit = Number((v as { base_price?: number }).base_price ?? unit)
      }
    }
  }

  if (item.ingredient_modifications) {
    const mods = item.ingredient_modifications
    const sumDelta = (list: { qty?: number; unit_price?: number }[] | undefined) =>
      (list ?? []).reduce((s, m) => s + (Number(m.qty ?? 0) * Number(m.unit_price ?? 0)), 0)
    unit += sumDelta(mods.extras)
    unit += sumDelta(mods.added)
  }

  return Math.max(0, Number(unit.toFixed(2)))
}

export async function POST(request: Request) {
  try {
    const body: CreateOrderRequest = await request.json()
    const { tenant_id, customer_name, customer_phone, items, order_type: rawOrderType, delivery_address: rawDeliveryAddress, location_id: rawLocationId, tip_cents: rawTipCents, menu_id: rawMenuId } = body

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

    const VALID_ORDER_TYPES = ['dine_in', 'pickup', 'delivery'] as const
    type OrderType = typeof VALID_ORDER_TYPES[number]
    const orderType: OrderType = (rawOrderType && VALID_ORDER_TYPES.includes(rawOrderType as OrderType))
      ? rawOrderType as OrderType
      : 'dine_in'

    const deliveryAddress = rawDeliveryAddress?.trim() || null

    if (orderType === 'delivery' && !deliveryAddress) {
      return NextResponse.json({ error: 'Delivery address is required for delivery orders' }, { status: 400 })
    }

    const service = await createServiceClient()

    const { data: tenantSettings, error: tenantError } = await service
      .from('tenants')
      .select('id, is_active, tenant_settings(orders_enabled, delivery_fee_cents)')
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

    // P2-07 fix: resolve canonical product prices server-side and ignore
    // client-supplied unit_price.
    const productIds = Array.from(new Set(items.map((i) => i.product_id)))
    const { data: dbProducts, error: productsError } = await service
      .from('products')
      .select('id, price, tenant_id')
      .in('id', productIds)
      .eq('tenant_id', tenant_id)

    if (productsError || !dbProducts) {
      console.error('orders.products_fetch_error', productsError)
      return NextResponse.json({ error: 'Failed to validate products' }, { status: 500 })
    }
    if (dbProducts.length !== productIds.length) {
      return NextResponse.json({ error: 'One or more products not found for this tenant' }, { status: 400 })
    }
    const priceById = new Map(dbProducts.map((p) => [p.id, p.price]))

    // SEED-019: apply price multiplier from private/in-store menu
    let priceMultiplier = 1
    if (rawMenuId) {
      const { data: menuRow } = await service
        .from('menus')
        .select('price_multiplier, tenant_id')
        .eq('id', rawMenuId)
        .eq('tenant_id', tenant_id)
        .single()
      if (menuRow?.price_multiplier && menuRow.price_multiplier > 0) {
        priceMultiplier = Number(menuRow.price_multiplier)
      }
    }

    const trustedItems = items.map((item) => {
      const baseUnit = computeItemUnitPrice({ price: priceById.get(item.product_id) ?? 0 }, item)
      const trustedUnit = priceMultiplier !== 1
        ? Math.round(baseUnit * priceMultiplier * 100) / 100
        : baseUnit
      return { ...item, unit_price: trustedUnit }
    })

    const total = trustedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)

    const deliveryFeeCents = orderType === 'delivery'
      ? Number((settings as any)?.delivery_fee_cents ?? 0)
      : 0

    const tipCents = Math.max(0, Math.floor(Number(rawTipCents ?? 0)))
    const orderTotal = Number((total + deliveryFeeCents / 100 + tipCents / 100).toFixed(2))

    const locationId = rawLocationId ?? null

    const { data: order, error: orderError } = await service
      .from('orders')
      .insert({
        tenant_id,
        customer_name: customer_name.trim(),
        customer_phone: customer_phone.trim(),
        status: 'pending',
        total: orderTotal,
        order_type: orderType,
        delivery_address: deliveryAddress,
        location_id: locationId,
        tip_cents: tipCents,
      })
      .select()
      .single()

    if (orderError || !order) {
      console.error('orders.create_error', orderError)
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }

    const orderItems = trustedItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      notes: sanitizeNote(item.notes),
      selected_options: item.selected_options || null,
      ingredient_modifications: item.ingredient_modifications || null,
    }))

    const { error: itemsError } = await service
      .from('order_items')
      .insert(orderItems)

    if (itemsError) {
      console.error('orders.items_create_error', itemsError)
      await service.from('orders').delete().eq('id', order.id)
      return NextResponse.json({ error: 'Failed to create order items' }, { status: 500 })
    }

    return NextResponse.json({ id: order.id, status: order.status, total: order.total, order_type: order.order_type })
  } catch (error) {
    console.error('orders.error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    // P0-07 fix: require auth, derive tenant from session, never trust query
    // string. Forbid customer-role accounts.
    const effective = await getEffectiveTenant()
    if (!effective) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (effective.role === 'customer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const service = await createServiceClient()
    const { data: orders, error: ordersError } = await service
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', effective.tenantId)
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
