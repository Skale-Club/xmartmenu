/**
 * How a restaurant serves orders, and what its plan allows:
 *
 *   menu          Digital Menu plan     guests browse (WhatsApp links still work)
 *   waiter        Menu + Orders plan    + staff take orders at the table (waiter app)
 *   self_service  Menu + Payments plan  + guests order and pay from the menu
 *
 * The plan sets the ceiling; inside it the restaurant switches each mode on in
 * its settings (direct_orders_enabled for guests, table_management_enabled for
 * the waiter app), with orders_enabled as the master switch. Every place that
 * lets an order through — public menu, checkout API, AI chat, waiter app —
 * decides with resolveServiceCapabilities, so they always agree.
 *
 * Pure: callers load the plan features (getTenantPlan) and settings.
 */

export type ServiceMode = 'menu' | 'waiter' | 'self_service'

export interface PlanServiceAccess {
  /** Staff may place orders for a table (waiter app). */
  waiter: boolean
  /** Guests may order (and pay, when Stripe is connected) from the menu. */
  selfOrder: boolean
}

/** Plan feature keys (plans.features) that unlock each mode. */
export const WAITER_FEATURE = 'orders'
export const SELF_ORDER_FEATURE = 'payments'

export function planServiceAccess(features: readonly string[] | null | undefined): PlanServiceAccess {
  const has = new Set(features ?? [])
  const selfOrder = has.has(SELF_ORDER_FEATURE)
  // Every plan that lets guests order also lets staff order.
  return { waiter: selfOrder || has.has(WAITER_FEATURE), selfOrder }
}

/** The richest mode the plan allows. */
export function planServiceMode(features: readonly string[] | null | undefined): ServiceMode {
  const access = planServiceAccess(features)
  return access.selfOrder ? 'self_service' : access.waiter ? 'waiter' : 'menu'
}

export interface ServiceSettings {
  orders_enabled?: boolean | null
  direct_orders_enabled?: boolean | null
  table_management_enabled?: boolean | null
  // Switches that only mean something inside an ordering mode. Read by
  // resolveTenantCapabilities; resolveServiceCapabilities ignores them.
  whatsapp_orders_enabled?: boolean | null
  whatsapp?: string | null
  tips_enabled?: boolean | null
  item_notes_enabled?: boolean | null
  ingredient_customization_enabled?: boolean | null
  dine_in_enabled?: boolean | null
  pickup_enabled?: boolean | null
  delivery_enabled?: boolean | null
  upsell_enabled?: boolean | null
}

export interface ServiceCapabilities extends PlanServiceAccess {
  /** Guests can build a cart and check out from the menu right now. */
  guestOrdering: boolean
  /** Staff can take orders in the waiter app right now. */
  waiterOrdering: boolean
}

export function resolveServiceCapabilities(
  features: readonly string[] | null | undefined,
  settings: ServiceSettings | null | undefined,
): ServiceCapabilities {
  const access = planServiceAccess(features)
  const ordersOn = settings?.orders_enabled === true
  return {
    ...access,
    guestOrdering: access.selfOrder && ordersOn && settings?.direct_orders_enabled === true,
    waiterOrdering: access.waiter && ordersOn && settings?.table_management_enabled === true,
  }
}

/** Plan feature keys that unlock things beyond ordering. */
export const STRIPE_FEATURE = 'stripe-connect'
export const BLOG_FEATURE = 'blog'

/** What the plan sells, before the restaurant's own switches. */
export interface PlanCeiling {
  /** Staff ordering: waiter app, tables, KDS, waiter calls. */
  orders: boolean
  /** Guest ordering from the menu: cart, checkout, order types, tips, delivery. */
  payments: boolean
  /** Online payment through Stripe Connect. */
  stripe: boolean
  /** Restaurant blog. */
  blog: boolean
}

export function planCeiling(features: readonly string[] | null | undefined): PlanCeiling {
  const has = new Set(features ?? [])
  const access = planServiceAccess(features)
  return {
    orders: access.waiter,
    payments: access.selfOrder,
    stripe: has.has(STRIPE_FEATURE),
    blog: has.has(BLOG_FEATURE),
  }
}

/**
 * Everything a screen or an API needs to know about what this restaurant can
 * do right now: the plan's ceiling, the modes it switched on, and every
 * feature that only exists inside a mode. One object, computed once per
 * request from the plan features and tenant_settings, passed down to the
 * admin panel, the public menu and the routes — nobody reads plans.features
 * or a raw settings flag on their own.
 *
 * Rules of thumb:
 *   - `plan.*` is the ceiling (what to show as locked / upgrade hints).
 *   - everything else is effective right now (what to show as working).
 *   - `showcase` is the public menu with no guest ordering: a price list.
 */
export interface TenantCapabilities extends ServiceCapabilities {
  /** The richest mode the plan allows. */
  mode: ServiceMode
  plan: PlanCeiling
  /** The public menu is view-only for guests (Digital Menu and Orders plans, or guest ordering switched off). */
  showcase: boolean
  /** Orders exist for this restaurant: the KDS and the orders page make sense. */
  kds: boolean
  /** Tables are managed (table links, waiter app table grid). */
  tables: boolean
  /** Guests on a table link may call a waiter or ask for the bill. */
  waiterCalls: boolean
  /** Guests may send their order as a WhatsApp message (any plan, needs a number). */
  whatsappOrders: boolean
  /** Guest checkout extras. */
  tips: boolean
  dineIn: boolean
  pickup: boolean
  delivery: boolean
  /** "Complete your order" suggestions after a dish is added. */
  upsell: boolean
  /** Per-item notes (guest checkout and waiter app). */
  itemNotes: boolean
  /** Ingredient add/remove on a dish (guest checkout and waiter app). */
  ingredientCustomization: boolean
}

export function resolveTenantCapabilities(
  features: readonly string[] | null | undefined,
  settings: ServiceSettings | null | undefined,
): TenantCapabilities {
  const service = resolveServiceCapabilities(features, settings)
  const plan = planCeiling(features)
  const ordersOn = settings?.orders_enabled === true
  const anyOrdering = service.guestOrdering || service.waiterOrdering
  const whatsappNumber = (settings?.whatsapp ?? '').replace(/\D/g, '')
  return {
    ...service,
    mode: planServiceMode(features),
    plan,
    showcase: !service.guestOrdering,
    kds: plan.orders,
    tables: plan.orders && ordersOn && settings?.table_management_enabled === true,
    waiterCalls: anyOrdering,
    whatsappOrders: ordersOn && settings?.whatsapp_orders_enabled === true && whatsappNumber.length > 0,
    tips: service.guestOrdering && settings?.tips_enabled === true,
    dineIn: service.guestOrdering && (settings?.dine_in_enabled ?? true) === true,
    pickup: service.guestOrdering && settings?.pickup_enabled === true,
    delivery: service.guestOrdering && settings?.delivery_enabled === true,
    upsell: service.guestOrdering && (settings?.upsell_enabled ?? true) === true,
    itemNotes: anyOrdering && settings?.item_notes_enabled === true,
    ingredientCustomization: anyOrdering && settings?.ingredient_customization_enabled === true,
  }
}

/** Capabilities of a restaurant with no plan at all: a showcase. */
export const NO_CAPABILITIES: TenantCapabilities = resolveTenantCapabilities(null, null)

export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = {
  menu: 'Menu only',
  waiter: 'Waiter ordering',
  self_service: 'Self-service with payment',
}

/** The plan to point a restaurant to when a mode is locked. */
export const PLAN_FOR_MODE: Record<Exclude<ServiceMode, 'menu'>, string> = {
  waiter: 'Menu + Orders',
  self_service: 'Menu + Payments',
}

/** `?table=<id>` on a menu link: the table the guest is sitting at. */
export const TABLE_PARAM = 'table'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseTableParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' && UUID.test(raw.trim()) ? raw.trim().toLowerCase() : null
}

/** The link printed on a table's QR code or written to its NFC tag. */
export function tableMenuUrl(menuUrl: string, tableId: string): string {
  const url = new URL(menuUrl)
  url.searchParams.set(TABLE_PARAM, tableId)
  return url.toString()
}
