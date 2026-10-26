import { describe, expect, it } from 'vitest'
import { describeLocked, lockedGroup, lockedGroups, planHint, planNameForNeed } from '@/components/admin/plan-hint'
import { analyticsView, includedInPlan, isShowcasePlan, quickStartPlan } from '@/components/admin/plan-views'
import { resolveTenantCapabilities } from '@/lib/service-modes'

const MENU = ['digital-menu']
const ORDERS = ['digital-menu', 'orders']
const PAYMENTS = ['digital-menu', 'orders', 'payments', 'stripe-connect', 'blog']
const ALL_ON = { orders_enabled: true, direct_orders_enabled: true, table_management_enabled: true }

describe('planHint', () => {
  it('is null when the plan includes the feature', () => {
    expect(planHint(resolveTenantCapabilities(PAYMENTS, null), 'payments')).toBeNull()
    expect(planHint(resolveTenantCapabilities(ORDERS, null), 'orders')).toBeNull()
  })

  it('names the plan that unlocks the feature', () => {
    const menu = resolveTenantCapabilities(MENU, null)
    expect(planHint(menu, 'orders', 'Tables')).toEqual({ planName: 'Menu + Orders', labels: ['Tables'] })
    expect(planHint(menu, 'payments', 'Tips')?.planName).toBe('Menu + Payments')
    expect(planNameForNeed('stripe')).toBe('Menu + Payments')
  })

  it('treats a plan with payments but no stripe key as locked for Stripe only', () => {
    const caps = resolveTenantCapabilities(['orders', 'payments'], null)
    expect(planHint(caps, 'payments')).toBeNull()
    expect(planHint(caps, 'stripe')?.planName).toBe('Menu + Payments')
  })
})

describe('lockedGroup', () => {
  it('builds the hint for one known-locked feature', () => {
    expect(lockedGroup('payments', 'Tips')).toEqual({ planName: 'Menu + Payments', labels: ['Tips'] })
    expect(lockedGroup('orders', 'Tables').planName).toBe('Menu + Orders')
  })
})

describe('lockedGroups', () => {
  const items = [
    { need: 'payments' as const, label: 'Tips' },
    { need: 'orders' as const, label: 'Tables' },
    { need: 'orders' as const, label: 'Kitchen timers' },
    { need: 'stripe' as const, label: 'Stripe' },
  ]

  it('groups by plan, cheapest plan first, in screen order', () => {
    const groups = lockedGroups(resolveTenantCapabilities(MENU, null).plan, items)
    expect(groups).toEqual([
      { planName: 'Menu + Orders', labels: ['Tables', 'Kitchen timers'] },
      { planName: 'Menu + Payments', labels: ['Tips', 'Stripe'] },
    ])
  })

  it('only lists what the plan leaves out', () => {
    expect(lockedGroups(resolveTenantCapabilities(ORDERS, null).plan, items)).toEqual([
      { planName: 'Menu + Payments', labels: ['Tips', 'Stripe'] },
    ])
    expect(lockedGroups(resolveTenantCapabilities(PAYMENTS, null).plan, items)).toEqual([])
  })

  it('describes the groups in one sentence per plan', () => {
    const groups = lockedGroups(resolveTenantCapabilities(MENU, null).plan, items)
    expect(describeLocked(groups)).toBe('Available on Menu + Orders: Tables, Kitchen timers. Available on Menu + Payments: Tips, Stripe.')
    expect(describeLocked([{ planName: 'Menu + Payments', labels: [''] }])).toBe('Available on Menu + Payments.')
  })
})

describe('includedInPlan / isShowcasePlan', () => {
  it('lists only what the plan sells', () => {
    expect(includedInPlan(resolveTenantCapabilities(MENU, null).plan)).toHaveLength(1)
    expect(includedInPlan(resolveTenantCapabilities(ORDERS, null).plan)).toHaveLength(2)
    expect(includedInPlan(resolveTenantCapabilities(PAYMENTS, null).plan)).toHaveLength(5)
  })

  it('flags the menu-only plan as a showcase', () => {
    expect(isShowcasePlan(resolveTenantCapabilities(MENU, null).plan)).toBe(true)
    expect(isShowcasePlan(resolveTenantCapabilities(ORDERS, null).plan)).toBe(false)
    expect(isShowcasePlan(resolveTenantCapabilities(null, null).plan)).toBe(true)
  })
})

describe('analyticsView', () => {
  it('hides every order metric on the menu-only plan', () => {
    expect(analyticsView(resolveTenantCapabilities(MENU, ALL_ON))).toEqual({ orderMetrics: false, guestCart: false, upsell: false })
  })

  it('keeps orders but not guest carts on the orders plan', () => {
    expect(analyticsView(resolveTenantCapabilities(ORDERS, ALL_ON))).toEqual({ orderMetrics: true, guestCart: false, upsell: false })
  })

  it('shows everything when guests order', () => {
    expect(analyticsView(resolveTenantCapabilities(PAYMENTS, ALL_ON))).toEqual({ orderMetrics: true, guestCart: true, upsell: true })
  })

  it('hides guest carts when the payments plan has guest ordering switched off', () => {
    const view = analyticsView(resolveTenantCapabilities(PAYMENTS, { ...ALL_ON, direct_orders_enabled: false }))
    expect(view).toEqual({ orderMetrics: true, guestCart: false, upsell: true })
  })
})

describe('quickStartPlan', () => {
  it('asks to turn on ordering only when the plan sells it and nothing is on', () => {
    expect(quickStartPlan(resolveTenantCapabilities(MENU, null)).turnOnOrdering).toBe(false)
    expect(quickStartPlan(resolveTenantCapabilities(ORDERS, null)).turnOnOrdering).toBe(true)
    expect(quickStartPlan(resolveTenantCapabilities(PAYMENTS, null)).turnOnOrdering).toBe(true)
    expect(quickStartPlan(resolveTenantCapabilities(ORDERS, ALL_ON)).turnOnOrdering).toBe(false)
    expect(quickStartPlan(resolveTenantCapabilities(PAYMENTS, ALL_ON)).turnOnOrdering).toBe(false)
  })
})
