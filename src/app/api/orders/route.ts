import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { isStripeEnabled } from '@/lib/stripe'
import { NextResponse } from 'next/server'
import type { IngredientModifications } from '@/types/database'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

interface CartEditorState {
  singleSelections?: Record<string, string>
  halfSelections?: Record<string, { half1: string | null; half2: string | null }>
  multiSelections?: Record<string, string[]>
}

interface OrderItem {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  notes?: string
  selected_options?: Record<string, unknown>
  ingredient_modifications?: IngredientModifications | null
  editor_state?: CartEditorState | null
}

interface CreateOrderRequest {
  tenant_id: string
  customer_name: string
  customer_phone: string
  items: OrderItem[]
  order_type?: string
  delivery_address?: string
  delivery_street?: string
  delivery_complement?: string
  delivery_zipcode?: string
  delivery_city?: string
  delivery_notes?: string
  location_id?: string | null
  tip_cents?: number
  menu_id?: string | null
  table_name?: string | null
}

function sanitizeNote(raw: string | undefined | null): string | null {
  if (!raw) return null
  const stripped = raw.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
  const trimmed = stripped.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 140)
}

type ServerOption = { id: string; base_price: number | null; price_modifier: number }
type ServerOptionGroup = { id: string; type: string; options: ServerOption[] }

// S04 #5: server-side option price, recomputed from the DB option rows the
// customer actually selected (resolved by id via editor_state). Mirrors
// ProductModal pricing exactly — single/half base_price REPLACE the running
// price, multiple modifiers add — so the client cannot tamper with prices.
function computeOptionUnit(
  basePrice: number,
  ed: CartEditorState | null | undefined,
  groups: ServerOptionGroup[],
): number {
  let unit = Number(basePrice ?? 0)
  if (!ed) return unit
  for (const g of groups) {
    if (g.type === 'single') {
      const optId = ed.singleSelections?.[g.id]
      if (optId) {
        const o = g.options.find((x) => x.id === optId)
        if (o) {
          if (o.base_price !== null) unit = Number(o.base_price)
          else unit += Number(o.price_modifier)
        }
      }
    } else if (g.type === 'half_and_half') {
      const half = ed.halfSelections?.[g.id]
      if (half?.half1 && half?.half2) {
        const o1 = g.options.find((x) => x.id === half.half1)
        const o2 = g.options.find((x) => x.id === half.half2)
        unit = Math.max(Number(o1?.base_price ?? 0), Number(o2?.base_price ?? 0))
      }
    } else if (g.type === 'multiple') {
      for (const optId of ed.multiSelections?.[g.id] ?? []) {
        const o = g.options.find((x) => x.id === optId)
        if (o) unit += Number(o.price_modifier)
      }
    }
  }
  return unit
}

// Ingredient delta recomputed from DB prices by ingredient_id (client unit_price
// is ignored). Removed ingredients are free.
function computeIngredientDelta(
  item: OrderItem,
  prices: Map<string, { extra: number; add: number }>,
): number {
  const mods = item.ingredient_modifications
  if (!mods) return 0
  let delta = 0
  for (const e of mods.extras ?? []) {
    const p = prices.get(e.ingredient_id)
    if (p) delta += Number(e.qty ?? 0) * p.extra
  }
  for (const a of mods.added ?? []) {
    const p = prices.get(a.ingredient_id)
    if (p) delta += Number(a.qty ?? 0) * p.add
  }
  return delta
}

export async function POST(request: Request) {
  try {
    const rl = await rateLimit('orders-create', getClientIp(request), 12, '1 m')
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

    const body: CreateOrderRequest = await request.json()
    const { tenant_id, customer_name, customer_phone, items, order_type: rawOrderType, delivery_address: rawDeliveryAddress, delivery_street: rawDeliveryStreet, delivery_complement: rawDeliveryComplement, delivery_zipcode: rawDeliveryZipcode, delivery_city: rawDeliveryCity, delivery_notes: rawDeliveryNotes, location_id: rawLocationId, tip_cents: rawTipCents, menu_id: rawMenuId, table_name: rawTableName } = body

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
    // S04: validate per-item shape and quantity server-side (positive integer,
    // sane cap) so a crafted payload cannot submit negative/huge/fractional
    // quantities that corrupt the total.
    for (const it of items) {
      if (!it?.product_id || typeof it.product_id !== 'string') {
        return NextResponse.json({ error: 'Invalid item' }, { status: 400 })
      }
      if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 99) {
        return NextResponse.json({ error: 'Invalid item quantity' }, { status: 400 })
      }
    }

    const VALID_ORDER_TYPES = ['dine_in', 'pickup', 'delivery'] as const
    type OrderType = typeof VALID_ORDER_TYPES[number]
    const orderType: OrderType = (rawOrderType && VALID_ORDER_TYPES.includes(rawOrderType as OrderType))
      ? rawOrderType as OrderType
      : 'dine_in'

    const deliveryStreet = rawDeliveryStreet?.trim() || null
    const deliveryAddress = deliveryStreet
      ? [rawDeliveryStreet?.trim(), rawDeliveryZipcode?.trim(), rawDeliveryCity?.trim()].filter(Boolean).join(', ')
      : (rawDeliveryAddress?.trim() || null)

    if (orderType === 'delivery' && !deliveryStreet && !deliveryAddress) {
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

    // Payment gating by order origin:
    //  - Staff/waiter orders (authenticated member of THIS tenant placing the
    //    order from the admin/waiter UI) skip online payment — paid at the
    //    counter. getEffectiveTenant() reflects the cookie session, which a
    //    waiter has and an anonymous QR customer does not.
    //  - Every other order (public menu / QR customer) MUST be paid online
    //    before reaching the kitchen, but only when the tenant actually has
    //    Stripe configured. If Stripe isn't enabled, fall back to the legacy
    //    "place order, pay in person" behavior.
    const effective = await getEffectiveTenant()
    const isStaffOrder = !!effective
      && effective.tenantId === tenant_id
      && (effective.role === 'store-admin' || effective.role === 'store-staff' || effective.role === 'superadmin')
    const requiresPayment = !isStaffOrder && await isStripeEnabled(tenant_id, service)
    const initialStatus = requiresPayment ? 'awaiting_payment' : 'pending'

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

    // S04 #5: load option groups + ingredient catalog so option/ingredient
    // prices are recomputed from the DB (productIds are already tenant-verified).
    const { data: groupRows } = await service
      .from('product_option_groups')
      .select('id, product_id, type, position, product_options(id, base_price, price_modifier)')
      .in('product_id', productIds)
      .order('position')
    const groupsByProduct = new Map<string, ServerOptionGroup[]>()
    for (const g of (groupRows ?? []) as Array<{ id: string; product_id: string; type: string; product_options?: Array<{ id: string; base_price: number | null; price_modifier: number }> }>) {
      const arr = groupsByProduct.get(g.product_id) ?? []
      arr.push({
        id: g.id,
        type: g.type,
        options: (g.product_options ?? []).map((o) => ({ id: o.id, base_price: o.base_price, price_modifier: Number(o.price_modifier ?? 0) })),
      })
      groupsByProduct.set(g.product_id, arr)
    }

    const { data: piRows } = await service
      .from('product_ingredients')
      .select('product_id, ingredient_id, extra_price_override, add_price_override, ingredients(default_extra_price, default_add_price)')
      .in('product_id', productIds)
    const ingredientPricesByProduct = new Map<string, Map<string, { extra: number; add: number }>>()
    for (const pi of (piRows ?? []) as Array<{ product_id: string; ingredient_id: string; extra_price_override: number | null; add_price_override: number | null; ingredients?: { default_extra_price?: number; default_add_price?: number } | null }>) {
      const m = ingredientPricesByProduct.get(pi.product_id) ?? new Map<string, { extra: number; add: number }>()
      m.set(pi.ingredient_id, {
        extra: Number(pi.extra_price_override ?? pi.ingredients?.default_extra_price ?? 0),
        add: Number(pi.add_price_override ?? pi.ingredients?.default_add_price ?? 0),
      })
      ingredientPricesByProduct.set(pi.product_id, m)
    }

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
      const basePrice = Number(priceById.get(item.product_id) ?? 0)
      const groups = groupsByProduct.get(item.product_id) ?? []
      const ingPrices = ingredientPricesByProduct.get(item.product_id) ?? new Map<string, { extra: number; add: number }>()
      const recomputed = computeOptionUnit(basePrice, item.editor_state, groups) + computeIngredientDelta(item, ingPrices)
      const baseUnit = Math.max(0, Number(recomputed.toFixed(2)))
      const trustedUnit = priceMultiplier !== 1
        ? Math.round(baseUnit * priceMultiplier * 100) / 100
        : baseUnit
      return { ...item, unit_price: trustedUnit }
    })

    const total = trustedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)

    let deliveryFeeCents = orderType === 'delivery'
      ? Number((settings as any)?.delivery_fee_cents ?? 0)
      : 0
    let resolvedZoneId: string | null = null

    if (orderType === 'delivery' && rawDeliveryZipcode) {
      const cleanZip = rawDeliveryZipcode.trim().replace(/\D/g, '')
      if (cleanZip) {
        const { data: activeZones } = await service
          .from('delivery_zones')
          .select('id, fee_cents, zipcode_prefixes')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
        const matched = (activeZones ?? []).find(z =>
          (z.zipcode_prefixes as string[]).some(p => cleanZip.startsWith(p))
        )
        if (matched) {
          deliveryFeeCents = matched.fee_cents
          resolvedZoneId = matched.id
        }
      }
    }

    const tipCents = Math.max(0, Math.floor(Number(rawTipCents ?? 0)))
    const orderTotal = Number((total + deliveryFeeCents / 100 + tipCents / 100).toFixed(2))

    const locationId = rawLocationId ?? null

    const { data: order, error: orderError } = await service
      .from('orders')
      .insert({
        tenant_id,
        customer_name: customer_name.trim(),
        customer_phone: customer_phone.trim(),
        status: initialStatus,
        total: orderTotal,
        order_type: orderType,
        delivery_address: deliveryAddress,
        delivery_street: orderType === 'delivery' ? (deliveryStreet || null) : null,
        delivery_complement: orderType === 'delivery' ? (rawDeliveryComplement?.trim() || null) : null,
        delivery_zipcode: orderType === 'delivery' ? (rawDeliveryZipcode?.trim() || null) : null,
        delivery_city: orderType === 'delivery' ? (rawDeliveryCity?.trim() || null) : null,
        delivery_notes: orderType === 'delivery' ? (rawDeliveryNotes?.trim() || null) : null,
        delivery_zone_id: resolvedZoneId,
        location_id: locationId,
        tip_cents: tipCents,
        table_name: rawTableName?.trim() || null,
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

    return NextResponse.json({ id: order.id, status: order.status, total: order.total, order_type: order.order_type, requires_payment: requiresPayment })
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
