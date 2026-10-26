import { describe, expect, it } from 'vitest'
import {
  isLaunchChecklistItemApplicable,
  LAUNCH_CHECKLIST_ITEMS,
  launchChecklistItemsFor,
  summarizeLaunchChecklist,
  type LaunchChecklistEntry,
} from '@/lib/launch-checklist'
import { deriveLaunchChecklistSignals } from '@/lib/admin/launch-checklist-signals'
import { planCeiling } from '@/lib/service-modes'

const MENU = planCeiling(['digital-menu', 'qr-code', 'analytics'])
const ORDERS = planCeiling(['digital-menu', 'orders', 'qr-code', 'analytics'])
const PAYMENTS = planCeiling(['digital-menu', 'orders', 'payments', 'stripe-connect', 'analytics'])
const keys = (access: Parameters<typeof launchChecklistItemsFor>[0]) => launchChecklistItemsFor(access).map(i => i.key)
const done = (): LaunchChecklistEntry => ({ status: 'done', note: '', updatedBy: null, updatedAt: null })

describe('launch checklist by plan', () => {
  it('the ordering items need a plan with orders; Stripe needs stripe-connect', () => {
    const requires = Object.fromEntries(LAUNCH_CHECKLIST_ITEMS.filter(i => i.requires).map(i => [i.key, i.requires]))
    expect(requires).toEqual({
      conversions: 'orders',
      forms_tested: 'orders',
      notifications: 'orders',
      stripe_connected: 'stripe',
    })
  })

  it('a Digital Menu restaurant is not asked about orders or Stripe', () => {
    const menuKeys = keys(MENU)
    for (const key of ['conversions', 'forms_tested', 'notifications', 'stripe_connected']) expect(menuKeys).not.toContain(key)
    expect(menuKeys).toContain('ga4')
    expect(menuKeys).toContain('site_published')
  })

  it('an orders restaurant gets the ordering items but not Stripe', () => {
    const ordersKeys = keys(ORDERS)
    for (const key of ['conversions', 'forms_tested', 'notifications']) expect(ordersKeys).toContain(key)
    expect(ordersKeys).not.toContain('stripe_connected')
  })

  it('a payments restaurant gets the whole catalog', () => {
    expect(keys(PAYMENTS)).toEqual(LAUNCH_CHECKLIST_ITEMS.map(i => i.key))
  })

  it('no plan counts as Digital Menu only', () => {
    expect(keys(null)).toEqual(keys(MENU))
    expect(keys(undefined)).toEqual(keys(MENU))
  })

  it('items without a requirement apply to everyone', () => {
    expect(isLaunchChecklistItemApplicable({}, null)).toBe(true)
    expect(isLaunchChecklistItemApplicable({ requires: 'stripe' }, ORDERS)).toBe(false)
    expect(isLaunchChecklistItemApplicable({ requires: 'stripe' }, PAYMENTS)).toBe(true)
  })

  it('progress only counts the items that apply', () => {
    const entries = { ga4: done(), forms_tested: done(), stripe_connected: done() }
    const menu = summarizeLaunchChecklist(entries, MENU)
    expect(menu.total).toBe(keys(MENU).length)
    expect(menu.done).toBe(1) // forms_tested and stripe_connected do not apply
    const payments = summarizeLaunchChecklist(entries, PAYMENTS)
    expect(payments.total).toBe(LAUNCH_CHECKLIST_ITEMS.length)
    expect(payments.done).toBe(3)
  })

  it('without a plan argument the whole catalog is counted (back-compat)', () => {
    expect(summarizeLaunchChecklist({}).total).toBe(LAUNCH_CHECKLIST_ITEMS.length)
  })

  it('a menu restaurant can be fully checked without the order items', () => {
    const entries = Object.fromEntries(keys(MENU).map(key => [key, done()]))
    expect(summarizeLaunchChecklist(entries, MENU)).toMatchObject({ pending: 0, percent: 100 })
  })
})

describe('stripe_connected signal', () => {
  const base = { isActive: true, customDomain: null, customDomainVerified: false, settings: null }

  it('reflects whether a Stripe account is connected', () => {
    expect(deriveLaunchChecklistSignals({ ...base, stripeConnected: true }).stripe_connected).toEqual({ ok: true })
    expect(deriveLaunchChecklistSignals({ ...base, stripeConnected: false }).stripe_connected).toEqual({ ok: false, reason: 'noStripe' })
  })

  it('is left out when the caller does not know', () => {
    expect(deriveLaunchChecklistSignals(base).stripe_connected).toBeUndefined()
  })
})
