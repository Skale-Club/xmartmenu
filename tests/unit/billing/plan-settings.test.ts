import { describe, expect, it } from 'vitest'
import { initialSettingsForPlan, liveFeatures, settingsPatchForPlan } from '@/lib/plan-settings'

const MENU = ['digital-menu', 'qr-code', 'analytics']
const ORDERS = ['digital-menu', 'orders', 'qr-code', 'analytics']
const PAYMENTS = ['digital-menu', 'orders', 'payments', 'stripe-connect', 'analytics']

describe('settingsPatchForPlan', () => {
  it('leaves a payments plan alone', () => {
    expect(settingsPatchForPlan(PAYMENTS)).toEqual({})
  })

  it('on the orders plan switches off guest ordering extras but keeps the waiter app', () => {
    expect(settingsPatchForPlan(ORDERS)).toEqual({
      direct_orders_enabled: false,
      tips_enabled: false,
      delivery_enabled: false,
      upsell_enabled: false,
    })
  })

  it('on the menu plan also switches off table management', () => {
    expect(settingsPatchForPlan(MENU)).toEqual({
      direct_orders_enabled: false,
      tips_enabled: false,
      delivery_enabled: false,
      upsell_enabled: false,
      table_management_enabled: false,
      item_notes_enabled: false,
      ingredient_customization_enabled: false,
    })
  })

  it('treats no plan like the menu plan', () => {
    expect(settingsPatchForPlan(null)).toEqual(settingsPatchForPlan(MENU))
    expect(settingsPatchForPlan([])).toEqual(settingsPatchForPlan(MENU))
  })

  it('never touches dine-in, pickup or the master orders switch', () => {
    const keys = Object.keys(settingsPatchForPlan([]))
    expect(keys).not.toContain('dine_in_enabled')
    expect(keys).not.toContain('pickup_enabled')
    expect(keys).not.toContain('orders_enabled')
  })

  it('only ever switches things off', () => {
    for (const features of [MENU, ORDERS, PAYMENTS, [], null]) {
      for (const value of Object.values(settingsPatchForPlan(features))) expect(value).toBe(false)
    }
  })
})

describe('liveFeatures', () => {
  it('grants the plan features only while the subscription is active or on trial', () => {
    expect(liveFeatures('active', PAYMENTS)).toEqual(PAYMENTS)
    expect(liveFeatures('trial', PAYMENTS)).toEqual(PAYMENTS)
    expect(liveFeatures('past_due', PAYMENTS)).toEqual([])
    expect(liveFeatures('cancelled', PAYMENTS)).toEqual([])
    expect(liveFeatures(null, PAYMENTS)).toEqual([])
  })

  it('a cancelled payments tenant is reconciled like a menu tenant', () => {
    expect(settingsPatchForPlan(liveFeatures('cancelled', PAYMENTS))).toEqual(settingsPatchForPlan(MENU))
    expect(settingsPatchForPlan(liveFeatures('past_due', ORDERS))).toEqual(settingsPatchForPlan(MENU))
  })
})

describe('initialSettingsForPlan', () => {
  it('starts a menu tenant with orders on and nothing else', () => {
    expect(initialSettingsForPlan(MENU)).toEqual({ orders_enabled: true })
  })

  it('starts an orders tenant with its tables on', () => {
    expect(initialSettingsForPlan(ORDERS)).toEqual({ orders_enabled: true, table_management_enabled: true })
  })

  it('starts a payments tenant in the mode it paid for', () => {
    expect(initialSettingsForPlan(PAYMENTS)).toEqual({
      orders_enabled: true,
      direct_orders_enabled: true,
      dine_in_enabled: true,
      table_management_enabled: true,
    })
  })
})
