import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { isStripeEnabled } from '@/lib/stripe'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { parseTableParam, type ServiceSettings, type TenantCapabilities } from '@/lib/service-modes'
import { NextResponse } from 'next/server'
import type { IngredientModifications } from '@/types/database'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { phoneMatchKey } from '@/lib/phone'
import { recordTrustedOrderAnalyticsEvent } from '@/lib/analytics/server'
import { OptionSelectionError, resolveOptionSelection, type ServerOptionGroup } from '@/lib/menu/option-pricing'
import { createOrderSchema, describeInputError, orderFingerprint, parseIdempotencyKey, type OrderItemInput } from '@/lib/orders/order-input'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

// KDS query bounds (shared intent with orders/page.tsx). A kitchen board only
// needs recent orders; older history lives elsewhere.
const ORDERS_WINDOW_MS = 2 * 24 * 60 * 60 * 1000 // 48h
const ORDERS_MAX_ROWS = 500
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type OrderType = 'dine_in' | 'pickup' | 'delivery'

const ORDER_TYPE_DISABLED: Record<OrderType, string> = {
  dine_in: 'Dine-in orders are not enabled for this restaurant',
  pickup: 'Pickup orders are not enabled for this restaurant',
  delivery: 'Delivery orders are not enabled for this restaurant',
}

/** The order types a guest may pick, in checkout order. */
function allowedGuestOrderTypes(caps: TenantCapabilities): OrderType[] {
  const allowed: OrderType[] = []
  if (caps.dineIn) allowed.push('dine_in')
  if (caps.pickup) allowed.push('pickup')
  if (caps.delivery) allowed.push('delivery')
  return allowed
}

/**
 * The caller has a phone-verified Supabase session: the same condition the
 * public menu page uses to render a private menu.
 */
async function hasPhoneVerifiedSession(): Promise<boolean> {
  try {
    const cookieClient = await createClient()
    const { data: { user } } = await cookieClient.auth.getUser()
    return !!user?.phone
  } catch {
    return false
  }
}

function sanitizeNote(raw: string | undefined | null): string | null {
  if (!raw) return null
  const stripped = raw.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
  const trimmed = stripped.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 140)
}

/** Money in cents, so totals are added as integers, never as floats. */
const toCents = (amount: number) => Math.round(Number(amount) * 100)
const fromCents = (cents: number) => cents / 100

type IngredientPrice = { name: string; extra: number; add: number }

/**
 * Ingredient changes against the product's own ingredients, priced from the
 * database (client unit_price is ignored; removals are free). Unknown ids are
 * dropped — never charged, never shown to the kitchen — names come from the
 * catalog, and quantities were bounded by the input schema (0..99), so a
 * crafted quantity cannot push a line below zero.
 */
function resolveIngredients(
  mods: OrderItemInput['ingredient_modifications'],
  prices: Map<string, IngredientPrice>,
): { modifications: IngredientModifications | null; delta: number } {
  if (!mods) return { modifications: null, delta: 0 }
  let delta = 0
  const removed = mods.removed
    .filter((r) => prices.has(r.ingredient_id))
    .map((r) => ({ ingredient_id: r.ingredient_id, name: prices.get(r.ingredient_id)!.name }))
  const extras = mods.extras
    .filter((e) => prices.has(e.ingredient_id) && (e.qty ?? 0) > 0)
    .map((e) => {
      const p = prices.get(e.ingredient_id)!
      delta += (e.qty ?? 0) * p.extra
      return { ingredient_id: e.ingredient_id, name: p.name, qty: e.qty ?? 0, unit_price: p.extra }
    })
  const added = mods.added
    .filter((a) => prices.has(a.ingredient_id) && (a.qty ?? 0) > 0)
    .map((a) => {
      const p = prices.get(a.ingredient_id)!
      delta += (a.qty ?? 0) * p.add
      return { ingredient_id: a.ingredient_id, name: p.name, qty: a.qty ?? 0, unit_price: p.add }
    })
  const empty = removed.length === 0 && extras.length === 0 && added.length === 0
  return { modifications: empty ? null : { removed, extras, added }, delta }
}

/** A line the catalog does not allow (unknown option, missing required choice…). */
class OrderRejected extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function handlePOST(request: Request) {
  try {
    const rl = await rateLimit('orders-create', getClientIp(request), 12, '1 m')
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

    // S04 / EX-03: one bounded contract for the whole payload (ids, sizes,
    // quantities, selections) before anything touches pricing or the database.
    const parsed = createOrderSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: describeInputError(parsed.error) }, { status: 400 })
    }
    const idempotencyKey = parseIdempotencyKey(request.headers.get('idempotency-key'))
    const { tenant_id, customer_name, customer_phone, items, order_type: rawOrderType, delivery_address: rawDeliveryAddress, delivery_street: rawDeliveryStreet, delivery_complement: rawDeliveryComplement, delivery_zipcode: rawDeliveryZipcode, delivery_city: rawDeliveryCity, delivery_notes: rawDeliveryNotes, location_id: rawLocationId, tip_cents: rawTipCents, menu_id: rawMenuId, table_name: rawTableName, table_id: rawTableId, analytics_session_id: rawAnalyticsSessionId } = parsed.data

    const service = await createServiceClient()

    const { data: tenantSettings, error: tenantError } = await service
      .from('tenants')
      // The capability switches (resolveTenantCapabilities) plus the delivery fee.
      .select('id, is_active, tenant_settings(orders_enabled, direct_orders_enabled, table_management_enabled, whatsapp_orders_enabled, whatsapp, tips_enabled, item_notes_enabled, ingredient_customization_enabled, dine_in_enabled, pickup_enabled, delivery_enabled, upsell_enabled, delivery_fee_cents, currency)')
      .eq('id', tenant_id)
      .eq('is_active', true)
      .single()

    if (tenantError || !tenantSettings) {
      return NextResponse.json({ error: 'Invalid tenant' }, { status: 400 })
    }
    const rawSettings = tenantSettings.tenant_settings as unknown
    const settings = (Array.isArray(rawSettings) ? rawSettings[0] : rawSettings) as (ServiceSettings & { delivery_fee_cents?: number | null; currency?: string | null }) | null | undefined
    if (!settings?.orders_enabled) {
      return NextResponse.json({ error: 'Orders not enabled for this tenant' }, { status: 403 })
    }

    // Analytics attribution is best-effort and can never block an order. Only a
    // real session owned by this tenant is attached; invalid or unavailable
    // analytics data is silently ignored.
    let analyticsSessionId: string | null = null
    if (rawAnalyticsSessionId && UUID_PATTERN.test(rawAnalyticsSessionId)) {
      const { data: analyticsSession } = await service
        .from('menu_sessions')
        .select('id, menu_id, location_id')
        .eq('id', rawAnalyticsSessionId)
        .eq('tenant_id', tenant_id)
        .maybeSingle()
      const menuMatches = !rawMenuId || analyticsSession?.menu_id === rawMenuId
      const locationMatches = !rawLocationId || analyticsSession?.location_id === rawLocationId
      if (analyticsSession && menuMatches && locationMatches) {
        analyticsSessionId = analyticsSession.id
      }
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

    // The plan sets which modes exist (service-modes.ts): staff orders need the
    // waiter mode, guest orders the self-service mode — each also switched on
    // by the restaurant. Checked here so a stale page or a script can't order
    // around a menu-only plan.
    const capabilities = await getTenantCapabilities(tenant_id, settings, service)
    if (isStaffOrder && !capabilities.waiterOrdering) {
      return NextResponse.json({ error: 'Waiter ordering is not enabled for this restaurant' }, { status: 403 })
    }
    if (!isStaffOrder && !capabilities.guestOrdering) {
      return NextResponse.json({ error: 'This restaurant does not take orders from the menu' }, { status: 403 })
    }

    // Order type: guests may only use the types the restaurant switched on.
    // Staff orders are taken at a table, so a table link always means dine-in;
    // the guest checkout switches don't apply to them.
    const requestedTableId = parseTableParam(rawTableId ?? undefined)
    let orderType: OrderType
    if (isStaffOrder) {
      orderType = requestedTableId ? 'dine_in' : (rawOrderType || 'dine_in')
    } else {
      const allowed = allowedGuestOrderTypes(capabilities)
      if (rawOrderType) {
        if (!allowed.includes(rawOrderType)) {
          return NextResponse.json({ error: ORDER_TYPE_DISABLED[rawOrderType] }, { status: 400 })
        }
        orderType = rawOrderType
      } else if (allowed.length > 0) {
        orderType = allowed[0]
      } else {
        return NextResponse.json({ error: 'This restaurant has no order type switched on' }, { status: 400 })
      }
    }

    const deliveryStreet = rawDeliveryStreet?.trim() || null
    const deliveryAddress = deliveryStreet
      ? [rawDeliveryStreet?.trim(), rawDeliveryZipcode?.trim(), rawDeliveryCity?.trim()].filter(Boolean).join(', ')
      : (rawDeliveryAddress?.trim() || null)

    if (orderType === 'delivery' && !deliveryStreet && !deliveryAddress) {
      return NextResponse.json({ error: 'Delivery address is required for delivery orders' }, { status: 400 })
    }

    // The schema bounds the tip (integer, 0..1,000,000 cents). A tip is only
    // accepted when the restaurant switched tips on.
    const tipCents = rawTipCents ?? 0
    if (tipCents > 0 && !capabilities.tips) {
      return NextResponse.json({ error: 'Tips are not enabled for this restaurant' }, { status: 400 })
    }

    // Item notes and ingredient changes only exist when switched on; anything a
    // stale page sends otherwise is dropped (ingredient changes before pricing,
    // so a dropped extra is never charged).
    const acceptedItems = items.map((item) => ({
      ...item,
      notes: capabilities.itemNotes ? item.notes : undefined,
      ingredient_modifications: capabilities.ingredientCustomization ? item.ingredient_modifications : null,
    }))

    // Branch: only an active location of this restaurant.
    let locationId: string | null = null
    if (rawLocationId) {
      const { data: location } = await service
        .from('locations')
        .select('id')
        .eq('id', rawLocationId)
        .eq('tenant_id', tenant_id)
        .eq('is_active', true)
        .maybeSingle()
      if (!location) return NextResponse.json({ error: 'Unknown location for this restaurant' }, { status: 400 })
      locationId = location.id
    }

    // Table: only a real, active table of this restaurant, and only for orders
    // eaten there. Its name comes from the database, never from the client;
    // staff may still type a free-text table when no id is sent.
    let tableId: string | null = null
    let tableName: string | null = isStaffOrder ? (rawTableName?.trim().slice(0, 80) || null) : null
    if (requestedTableId && orderType === 'dine_in') {
      const { data: table } = await service
        .from('restaurant_tables')
        .select('id, name')
        .eq('id', requestedTableId)
        .eq('tenant_id', tenant_id)
        .eq('is_active', true)
        .maybeSingle()
      if (table) {
        tableId = table.id
        tableName = table.name
      }
    }
    if (orderType !== 'dine_in') tableName = null

    const requiresPayment = !isStaffOrder && await isStripeEnabled(tenant_id, service)
    const initialStatus = requiresPayment ? 'awaiting_payment' : 'pending'

    // ── Catalog, from the database only (P2-07 / EX-03) ───────────────────────
    // Products of this restaurant with their menu: the menu decides whether the
    // guest may order them (private menus) and which multiplier applies. Any
    // failed read stops the order: an unreachable catalog must never be priced
    // as an empty one.
    const productIds = Array.from(new Set(items.map((i) => i.product_id)))
    const { data: dbProducts, error: productsError } = await service
      .from('products')
      .select('id, name, price, tenant_id, is_available, menu_id, menus(id, is_active, is_private, price_multiplier)')
      .in('id', productIds)
      .eq('tenant_id', tenant_id)

    if (productsError || !dbProducts) {
      log.error('orders.products_fetch_error', { err: productsError })
      return NextResponse.json({ error: 'Failed to validate products' }, { status: 503 })
    }
    if (dbProducts.length !== productIds.length) {
      return NextResponse.json({ error: 'One or more products not found for this tenant' }, { status: 400 })
    }
    // Re-validate availability at order time: cached menus can show a sold-out
    // item for a moment, and a replayed/crafted cart must not be able to order
    // a product the kitchen has disabled.
    if (dbProducts.some((p) => p.is_available === false)) {
      return NextResponse.json({ error: 'One or more items are no longer available' }, { status: 409 })
    }

    type MenuRow = { id: string; is_active: boolean | null; is_private: boolean | null; price_multiplier: number | null }
    const menus = new Map<string, MenuRow>()
    for (const p of dbProducts) {
      const raw = (p as { menus?: MenuRow | MenuRow[] | null }).menus
      const m = (Array.isArray(raw) ? raw[0] : raw) ?? null
      if (!m || m.is_active === false) {
        return NextResponse.json({ error: 'One or more items are no longer available' }, { status: 409 })
      }
      menus.set(m.id, m)
    }
    // One order, one menu: its multiplier prices every line, and the menu the
    // page said it showed must be that menu.
    if (menus.size !== 1) {
      return NextResponse.json({ error: 'All items must come from the same menu' }, { status: 400 })
    }
    const [orderMenu] = menus.values()
    if (rawMenuId && rawMenuId !== orderMenu.id) {
      return NextResponse.json({ error: 'Items do not belong to this menu' }, { status: 400 })
    }

    // SEED-019: a private menu is shown (with multiplied prices) only to a
    // phone-verified session, so a guest order on it must come from one. The
    // check follows the products' own menu, so leaving menu_id out of the
    // request cannot skip it. Staff orders may always use it.
    if (orderMenu.is_private === true && !isStaffOrder && !(await hasPhoneVerifiedSession())) {
      return NextResponse.json({ error: 'This menu requires signing in' }, { status: 403 })
    }
    const priceMultiplier = orderMenu.price_multiplier && Number(orderMenu.price_multiplier) > 0 ? Number(orderMenu.price_multiplier) : 1

    const [groupsResult, ingredientsResult] = await Promise.all([
      service
        .from('product_option_groups')
        .select('id, product_id, name, type, required, min_selections, max_selections, position, product_options(id, name, base_price, price_modifier, is_available)')
        .in('product_id', productIds)
        .order('position'),
      service
        .from('product_ingredients')
        .select('product_id, ingredient_id, extra_price_override, add_price_override, ingredients(name, default_extra_price, default_add_price)')
        .in('product_id', productIds),
    ])
    if (groupsResult.error || ingredientsResult.error) {
      log.error('orders.catalog_fetch_error', { err: groupsResult.error ?? ingredientsResult.error })
      return NextResponse.json({ error: 'Failed to validate the menu, please try again' }, { status: 503 })
    }

    const groupsByProduct = new Map<string, ServerOptionGroup[]>()
    for (const g of (groupsResult.data ?? []) as Array<{ id: string; product_id: string; name: string; type: string; required: boolean | null; min_selections: number | null; max_selections: number | null; product_options?: Array<{ id: string; name: string; base_price: number | null; price_modifier: number; is_available: boolean | null }> }>) {
      const arr = groupsByProduct.get(g.product_id) ?? []
      arr.push({
        id: g.id,
        name: g.name,
        type: g.type,
        required: g.required,
        min_selections: g.min_selections,
        max_selections: g.max_selections,
        options: (g.product_options ?? []).map((o) => ({ id: o.id, name: o.name, base_price: o.base_price, price_modifier: Number(o.price_modifier ?? 0), is_available: o.is_available })),
      })
      groupsByProduct.set(g.product_id, arr)
    }

    const ingredientPricesByProduct = new Map<string, Map<string, IngredientPrice>>()
    for (const pi of (ingredientsResult.data ?? []) as Array<{ product_id: string; ingredient_id: string; extra_price_override: number | null; add_price_override: number | null; ingredients?: { name?: string; default_extra_price?: number; default_add_price?: number } | null }>) {
      const m = ingredientPricesByProduct.get(pi.product_id) ?? new Map<string, IngredientPrice>()
      m.set(pi.ingredient_id, {
        name: pi.ingredients?.name ?? 'Ingredient',
        extra: Number(pi.extra_price_override ?? pi.ingredients?.default_extra_price ?? 0),
        add: Number(pi.add_price_override ?? pi.ingredients?.default_add_price ?? 0),
      })
      ingredientPricesByProduct.set(pi.product_id, m)
    }

    // ── Price every line from the catalog ──────────────────────────────────────
    // Name, option labels and price all come from the database. The multiplier
    // is applied exactly once, to the whole unit (dish, options, ingredients),
    // rounded to cents: the rule the menu page displays.
    const productById = new Map(dbProducts.map((p) => [p.id, p]))
    let trustedItems: Array<{
      product_id: string
      product_name: string
      quantity: number
      unit_cents: number
      notes: string | null
      selected_options: Record<string, string> | null
      ingredient_modifications: IngredientModifications | null
      added_via: 'upsell' | 'chat' | null
    }>
    try {
      trustedItems = acceptedItems.map((item) => {
        const product = productById.get(item.product_id)!
        let options
        try {
          options = resolveOptionSelection(Number(product.price), item.editor_state, groupsByProduct.get(item.product_id) ?? [])
        } catch (e) {
          if (e instanceof OptionSelectionError) throw new OrderRejected(400, `${product.name}: ${e.message}`)
          throw e
        }
        const ingredients = resolveIngredients(item.ingredient_modifications, ingredientPricesByProduct.get(item.product_id) ?? new Map())
        const baseCents = Math.max(0, toCents(options.unit + ingredients.delta))
        return {
          product_id: item.product_id,
          product_name: product.name as string,
          quantity: item.quantity,
          unit_cents: priceMultiplier !== 1 ? Math.round(baseCents * priceMultiplier) : baseCents,
          notes: sanitizeNote(item.notes),
          selected_options: Object.keys(options.labels).length ? options.labels : null,
          ingredient_modifications: ingredients.modifications,
          added_via: item.added_via === 'upsell' || item.added_via === 'chat' ? item.added_via : null,
        }
      })
    } catch (e) {
      if (e instanceof OrderRejected) return NextResponse.json({ error: e.message }, { status: e.status })
      throw e
    }

    const subtotalCents = trustedItems.reduce((sum, item) => sum + item.unit_cents * item.quantity, 0)

    let deliveryFeeCents = orderType === 'delivery'
      ? Number(settings?.delivery_fee_cents ?? 0)
      : 0
    let resolvedZoneId: string | null = null

    if (orderType === 'delivery' && rawDeliveryZipcode) {
      const cleanZip = rawDeliveryZipcode.trim().replace(/\D/g, '')
      if (cleanZip) {
        const { data: activeZones, error: zonesError } = await service
          .from('delivery_zones')
          .select('id, fee_cents, zipcode_prefixes')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
        if (zonesError) {
          log.error('orders.zones_fetch_error', { err: zonesError })
          return NextResponse.json({ error: 'Failed to validate the delivery area, please try again' }, { status: 503 })
        }
        const matched = (activeZones ?? []).find(z =>
          (z.zipcode_prefixes as string[]).some(p => cleanZip.startsWith(p))
        )
        if (matched) {
          deliveryFeeCents = matched.fee_cents
          resolvedZoneId = matched.id
        }
      }
    }

    const totalCents = subtotalCents + deliveryFeeCents + tipCents

    const orderRow = {
      tenant_id,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone.trim(),
      customer_phone_key: phoneMatchKey(customer_phone),
      status: initialStatus,
      total: fromCents(totalCents),
      // Snapshot of what was charged: items, delivery, currency at order time.
      subtotal: fromCents(subtotalCents),
      delivery_fee_cents: deliveryFeeCents,
      currency: settings?.currency ?? null,
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
      table_name: tableName,
      table_id: tableId,
      analytics_session_id: analyticsSessionId,
    }
    const itemRows = trustedItems.map(({ unit_cents, ...item }) => ({ ...item, unit_price: fromCents(unit_cents) }))

    // Order and items in one transaction (the kitchen never sees a header
    // without its items); the same Idempotency-Key with the same order returns
    // the first order instead of creating a second one.
    const { data: created, error: createError } = await service.rpc('create_order_with_items', {
      p_order: {
        ...orderRow,
        idempotency_key: idempotencyKey,
        request_fingerprint: idempotencyKey ? orderFingerprint({ order: orderRow, items: itemRows }) : null,
      },
      p_items: itemRows,
    })

    if (createError || !created) {
      if (createError?.code === 'P0409') {
        return NextResponse.json({ error: 'This checkout was already used for a different order' }, { status: 409 })
      }
      log.error('orders.create_error', { err: createError })
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }
    const order = created as { id: string; status: string; total: number | string; order_type: string; replayed: boolean }

    if (analyticsSessionId && !order.replayed) await recordTrustedOrderAnalyticsEvent(order.id, 'order_created')

    return NextResponse.json({ id: order.id, status: order.status, total: Number(order.total), order_type: order.order_type, requires_payment: requiresPayment })
  } catch (error) {
    log.error('orders.error', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function handleGET() {
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
    const capabilities = await getTenantCapabilities(effective.tenantId, undefined, service)
    if (!capabilities.kds) {
      return NextResponse.json({ error: 'The kitchen display is part of the Menu + Orders plan' }, { status: 403 })
    }

    // Bound the result: without a window + limit this returns the tenant's ENTIRE
    // order history (with items) on every 15s KDS poll, and PostgREST silently
    // truncates at 1000 rows — so past ~1000 orders the KDS would show an
    // arbitrary subset. A KDS is an operational board, so scope it to a recent
    // window plus a hard cap (most-recent first).
    const cutoff = new Date(Date.now() - ORDERS_WINDOW_MS).toISOString()
    const { data: orders, error: ordersError } = await service
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', effective.tenantId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(ORDERS_MAX_ROWS)

    if (ordersError) {
      log.error('orders.fetch_error', { err: ordersError })
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
    }

    return NextResponse.json({ orders: orders ?? [] })
  } catch (error) {
    log.error('orders.fetch_error', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const POST = withApi('POST /api/orders', handlePOST)
export const GET = withApi('GET /api/orders', handleGET)
