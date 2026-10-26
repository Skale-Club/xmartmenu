import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCREEN_STATE,
  allowedOrderTypes,
  checkoutFields,
  defaultOrderTypeFor,
  sanitizeScreenState,
  type CheckoutDraft,
  type GuestOrderingRules,
  type MenuScreenState,
} from '@/components/menu/menu-session'
import { describeOrdering, resolveOrderingMode } from '@/lib/chat-context'

const showcase: GuestOrderingRules = { guestOrdering: false, tips: false, dineIn: false, pickup: false, delivery: false }
const full: GuestOrderingRules = { guestOrdering: true, tips: true, dineIn: true, pickup: true, delivery: true }
const noTipsNoDelivery: GuestOrderingRules = { guestOrdering: true, tips: false, dineIn: false, pickup: true, delivery: false }

const draft: CheckoutDraft = {
  customerName: 'Ana', customerPhone: '555', orderType: 'delivery',
  deliveryStreet: '1 Main St', deliveryComplement: 'Apt 2', deliveryZipcode: '10001', deliveryCity: 'NYC', deliveryNotes: 'Ring',
  tipCents: 300,
}
const saved: MenuScreenState = {
  ...EMPTY_SCREEN_STATE,
  cartOpen: true,
  checkoutOpen: true,
  draft,
  placedOrder: { id: 'o1', items: [] },
}

describe('order types by capabilities', () => {
  it('lists only what the plan and the restaurant allow; dine-in only at a table', () => {
    expect(allowedOrderTypes(showcase, false)).toEqual([])
    expect(allowedOrderTypes(full, false)).toEqual(['dine_in', 'pickup', 'delivery'])
    expect(allowedOrderTypes(full, true)).toEqual(['dine_in'])
    expect(allowedOrderTypes(noTipsNoDelivery, false)).toEqual(['pickup'])
    expect(defaultOrderTypeFor(noTipsNoDelivery, false)).toBe('pickup')
    expect(defaultOrderTypeFor(noTipsNoDelivery, true)).toBe('dine_in')
    expect(defaultOrderTypeFor(showcase, false)).toBe('dine_in')
  })
})

describe('sanitizeScreenState (restoring an old tab)', () => {
  it('never reopens checkout or keeps a draft when guests cannot order', () => {
    expect(sanitizeScreenState(saved, showcase, false)).toEqual({ ...saved, cartOpen: false, checkoutOpen: false, draft: null, placedOrder: null })
  })

  it('forces dine-in and drops delivery fields at a table', () => {
    const out = sanitizeScreenState(saved, full, true)
    expect(out.checkoutOpen).toBe(true)
    expect(out.draft).toEqual({ ...draft, orderType: 'dine_in', deliveryStreet: '', deliveryComplement: '', deliveryZipcode: '', deliveryCity: '', deliveryNotes: '' })
  })

  it('drops a delivery the restaurant no longer offers, and the tip when tips are off', () => {
    const out = sanitizeScreenState(saved, noTipsNoDelivery, false)
    expect(out.draft?.orderType).toBe('pickup')
    expect(out.draft?.deliveryStreet).toBe('')
    expect(out.draft?.tipCents).toBe(0)
    expect(out.draft?.customerName).toBe('Ana')
  })

  it('keeps an allowed draft as it was', () => {
    expect(sanitizeScreenState(saved, full, false)).toEqual(saved)
  })
})

describe('checkoutFields (POST /api/orders)', () => {
  it('sends delivery fields only for an allowed delivery and the tip only when tips are on', () => {
    expect(checkoutFields(draft, full, false)).toEqual({
      order_type: 'delivery',
      delivery_street: '1 Main St',
      delivery_complement: 'Apt 2',
      delivery_zipcode: '10001',
      delivery_city: 'NYC',
      delivery_notes: 'Ring',
      delivery_address: '1 Main St, 10001, NYC',
      tip_cents: 300,
    })
  })

  it('is dine-in with no delivery fields at a table', () => {
    expect(checkoutFields(draft, full, true)).toEqual({ order_type: 'dine_in', tip_cents: 300 })
  })

  it('never sends a tip or delivery the plan does not allow', () => {
    expect(checkoutFields(draft, noTipsNoDelivery, false)).toEqual({ order_type: 'pickup' })
    expect(checkoutFields({ ...draft, tipCents: 0 }, full, true)).toEqual({ order_type: 'dine_in' })
  })
})

describe('AI assistant ordering rules by capabilities', () => {
  const ordersPlan = { guestOrdering: false, waiterOrdering: true, waiterCalls: true, whatsappOrders: false }
  const digitalMenu = { guestOrdering: false, waiterOrdering: false, waiterCalls: false, whatsappOrders: false }

  it('lets the plan decide the mode, whatever the raw switches say', () => {
    expect(resolveOrderingMode({ orders_enabled: true, direct_orders_enabled: true }, digitalMenu)).toBe('browse')
    expect(resolveOrderingMode({}, { ...digitalMenu, guestOrdering: true })).toBe('cart')
    expect(resolveOrderingMode({}, { ...digitalMenu, whatsappOrders: true })).toBe('whatsapp')
  })

  it('points a guest at a table to the waiter on the Orders plan', () => {
    const text = describeOrdering({}, { onlinePayment: false, deliveryZones: [], capabilities: ordersPlan, atTable: true })
    expect(text).toContain('You CANNOT add items to a cart')
    expect(text).toContain('Call waiter')
    expect(text).not.toContain('suggest contacting the restaurant')
  })

  it('suggests asking the staff off a table on the Orders plan, and the restaurant on Digital Menu', () => {
    expect(describeOrdering({}, { onlinePayment: false, deliveryZones: [], capabilities: ordersPlan })).toContain('asking a waiter')
    expect(describeOrdering({}, { onlinePayment: false, deliveryZones: [], capabilities: digitalMenu })).toContain('suggest contacting the restaurant')
  })
})
