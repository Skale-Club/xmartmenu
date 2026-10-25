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
