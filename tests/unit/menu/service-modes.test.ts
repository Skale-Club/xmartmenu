import { describe, expect, it } from 'vitest'
import {
  parseTableParam,
  planServiceAccess,
  planServiceMode,
  resolveServiceCapabilities,
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
