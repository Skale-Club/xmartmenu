import { describe, expect, it } from 'vitest'
import {
  parseTableParam,
  planServiceAccess,
  planServiceMode,
  resolveServiceCapabilities,
  resolveTenantCapabilities,
  planCeiling,
  NO_CAPABILITIES,
  tableMenuUrl,
} from '@/lib/service-modes'

const MENU = ['digital-menu', 'qr-code', 'analytics']
const ORDERS = ['digital-menu', 'orders', 'qr-code', 'analytics']
const PAYMENTS = ['digital-menu', 'orders', 'payments', 'stripe-connect', 'analytics']
const ALL_ON = { orders_enabled: true, direct_orders_enabled: true, table_management_enabled: true }

describe('plan → service mode', () => {
  it('maps the three plans to the three modes', () => {
    expect(planServiceMode(MENU)).toBe('menu')
    expect(planServiceMode(ORDERS)).toBe('waiter')
    expect(planServiceMode(PAYMENTS)).toBe('self_service')
  })

  it('treats no plan or a revoked plan as menu only', () => {
    expect(planServiceMode(null)).toBe('menu')
    expect(planServiceMode([])).toBe('menu')
  })

  it('lets every self-service plan use the waiter app too', () => {
    expect(planServiceAccess(['payments'])).toEqual({ waiter: true, selfOrder: true })
  })
})

describe('resolveServiceCapabilities', () => {
  it('never goes beyond the plan, whatever the settings say', () => {
    expect(resolveServiceCapabilities(MENU, ALL_ON)).toMatchObject({ guestOrdering: false, waiterOrdering: false })
    expect(resolveServiceCapabilities(ORDERS, ALL_ON)).toMatchObject({ guestOrdering: false, waiterOrdering: true })
    expect(resolveServiceCapabilities(PAYMENTS, ALL_ON)).toMatchObject({ guestOrdering: true, waiterOrdering: true })
  })

  it('lets the restaurant switch each mode inside its plan', () => {
    expect(resolveServiceCapabilities(PAYMENTS, { ...ALL_ON, direct_orders_enabled: false })).toMatchObject({ guestOrdering: false, waiterOrdering: true })
    expect(resolveServiceCapabilities(PAYMENTS, { ...ALL_ON, table_management_enabled: false })).toMatchObject({ guestOrdering: true, waiterOrdering: false })
  })

  it('turns everything off with the master switch', () => {
    expect(resolveServiceCapabilities(PAYMENTS, { ...ALL_ON, orders_enabled: false })).toMatchObject({ guestOrdering: false, waiterOrdering: false })
    expect(resolveServiceCapabilities(PAYMENTS, null)).toMatchObject({ guestOrdering: false, waiterOrdering: false })
  })
})

describe('table links', () => {
  const id = '0f8a2c1e-4b3d-4e5f-9a6b-7c8d9e0f1a2b'

  it('adds the table to the menu link', () => {
    expect(tableMenuUrl('https://xmartmenu.skale.club/aurora', id)).toBe(`https://xmartmenu.skale.club/aurora?table=${id}`)
    expect(tableMenuUrl('https://xmartmenu.skale.club/aurora?lang=pt', id)).toBe(`https://xmartmenu.skale.club/aurora?lang=pt&table=${id}`)
  })

  it('accepts only table ids', () => {
    expect(parseTableParam(id.toUpperCase())).toBe(id)
    expect(parseTableParam([id])).toBe(id)
    expect(parseTableParam('4')).toBeNull()
    expect(parseTableParam("x' or 1=1")).toBeNull()
    expect(parseTableParam(undefined)).toBeNull()
  })
})

describe('resolveTenantCapabilities', () => {
  const EVERYTHING_ON = {
    ...ALL_ON,
    whatsapp_orders_enabled: true, whatsapp: '+1 (555) 000-0000',
    tips_enabled: true, item_notes_enabled: true, ingredient_customization_enabled: true,
    dine_in_enabled: true, pickup_enabled: true, delivery_enabled: true, upsell_enabled: true,
  }

  it('reports the plan ceiling separately from what is switched on', () => {
    expect(planCeiling(MENU)).toEqual({ orders: false, payments: false, stripe: false, blog: false })
    expect(planCeiling(ORDERS)).toEqual({ orders: true, payments: false, stripe: false, blog: false })
    expect(planCeiling(PAYMENTS)).toEqual({ orders: true, payments: true, stripe: true, blog: false })
    expect(planCeiling([...PAYMENTS, 'blog']).blog).toBe(true)
  })

  it('is a showcase on Digital Menu whatever the switches say', () => {
    const caps = resolveTenantCapabilities(MENU, EVERYTHING_ON)
    expect(caps.showcase).toBe(true)
    expect(caps.kds).toBe(false)
    expect(caps.tables).toBe(false)
    expect(caps.waiterCalls).toBe(false)
    expect(caps.tips).toBe(false)
    expect(caps.delivery).toBe(false)
    expect(caps.upsell).toBe(false)
    expect(caps.itemNotes).toBe(false)
    expect(caps.ingredientCustomization).toBe(false)
    // WhatsApp ordering is the one thing a showcase keeps.
    expect(caps.whatsappOrders).toBe(true)
  })

  it('on Menu + Orders the guest still browses, staff order, tables and calls work', () => {
    const caps = resolveTenantCapabilities(ORDERS, EVERYTHING_ON)
    expect(caps).toMatchObject({ mode: 'waiter', showcase: true, kds: true, tables: true, waiterCalls: true, waiterOrdering: true, guestOrdering: false })
    expect(caps.tips).toBe(false)
    expect(caps.upsell).toBe(false)
    // Notes and ingredients exist for the waiter app.
    expect(caps.itemNotes).toBe(true)
    expect(caps.ingredientCustomization).toBe(true)
  })

  it('on Menu + Payments with guest ordering on, everything follows its own switch', () => {
    const caps = resolveTenantCapabilities(PAYMENTS, EVERYTHING_ON)
    expect(caps).toMatchObject({ mode: 'self_service', showcase: false, kds: true, tables: true, tips: true, dineIn: true, pickup: true, delivery: true, upsell: true })
    expect(resolveTenantCapabilities(PAYMENTS, { ...EVERYTHING_ON, tips_enabled: false }).tips).toBe(false)
    expect(resolveTenantCapabilities(PAYMENTS, { ...EVERYTHING_ON, upsell_enabled: false }).upsell).toBe(false)
  })

  it('turns into a showcase when guest ordering is switched off, keeping the KDS for staff', () => {
    const caps = resolveTenantCapabilities(PAYMENTS, { ...EVERYTHING_ON, direct_orders_enabled: false })
    expect(caps.showcase).toBe(true)
    expect(caps.kds).toBe(true)
    expect(caps.tips).toBe(false)
    expect(caps.delivery).toBe(false)
  })

  it('needs a WhatsApp number for WhatsApp orders', () => {
    expect(resolveTenantCapabilities(MENU, { ...EVERYTHING_ON, whatsapp: '' }).whatsappOrders).toBe(false)
    expect(resolveTenantCapabilities(MENU, { ...EVERYTHING_ON, orders_enabled: false }).whatsappOrders).toBe(false)
  })

  it('treats no plan as a plain showcase', () => {
    expect(NO_CAPABILITIES).toMatchObject({ mode: 'menu', showcase: true, kds: false, guestOrdering: false, waiterOrdering: false })
  })
})
