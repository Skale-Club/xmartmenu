/**
 * Pure decisions about what a panel screen shows for a plan. Kept apart from
 * the React code so the rules are unit-tested (tests/unit/admin).
 */
import type { PlanCeiling, TenantCapabilities } from '@/lib/service-modes'

type Plan = Pick<PlanCeiling, 'orders' | 'payments' | 'stripe' | 'blog'>

/** Short lines for the dashboard's "Included in your plan" list. */
export function includedInPlan(plan: Plan): string[] {
  const lines = ['Digital menu with QR code and analytics']
  if (plan.orders) lines.push('Waiter app, tables and the kitchen display')
  if (plan.payments) lines.push('Guest ordering with tips, order types and "Complete your order"')
  if (plan.stripe) lines.push('Online payments with Stripe')
  if (plan.blog) lines.push('Restaurant blog')
  return lines
}

/** True on the plan that sells only the menu: no orders of any kind. */
export function isShowcasePlan(plan: Pick<PlanCeiling, 'orders' | 'payments'>): boolean {
  return !plan.orders && !plan.payments
}

export interface AnalyticsView {
  /** Completed orders, revenue, conversion, time to order. */
  orderMetrics: boolean
  /** Added to cart / checkout started, add and remove rates: guests building carts. */
  guestCart: boolean
  /** The "Complete your order" attribution section. */
  upsell: boolean
}

export function analyticsView(
  capabilities: Pick<TenantCapabilities, 'kds' | 'showcase'> & { plan: Pick<PlanCeiling, 'payments'> },
): AnalyticsView {
  return {
    orderMetrics: capabilities.kds,
    guestCart: capabilities.kds && !capabilities.showcase,
    upsell: capabilities.kds && capabilities.plan.payments,
  }
}

export interface QuickStartPlan {
  /** Show the "Turn on ordering" step. */
  turnOnOrdering: boolean
}

/** The plan sells ordering but nobody has switched it on yet. */
export function quickStartPlan(
  capabilities: Pick<TenantCapabilities, 'waiterOrdering' | 'guestOrdering'> & { plan: Pick<PlanCeiling, 'orders' | 'payments'> },
): QuickStartPlan {
  return {
    turnOnOrdering:
      (capabilities.plan.orders || capabilities.plan.payments) && !capabilities.waiterOrdering && !capabilities.guestOrdering,
  }
}
