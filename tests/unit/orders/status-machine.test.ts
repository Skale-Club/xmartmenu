import { describe, expect, it } from 'vitest'
import { canKitchenMove, paymentTransition } from '@/lib/orders/status-machine'

describe('paymentTransition', () => {
  it('a later success of the same intent pays an order whose attempt failed', () => {
    expect(paymentTransition('payment_failed', 'succeeded')).toEqual({ next: 'paid' })
  })

  it('a late failure never undoes a payment or the kitchen', () => {
    for (const s of ['paid', 'preparing', 'ready', 'out_for_delivery', 'done']) {
      expect(paymentTransition(s, 'failed').next).toBeNull()
      expect(paymentTransition(s, 'canceled').next).toBeNull()
      expect(paymentTransition(s, 'succeeded').next).toBeNull()
    }
  })

  it('payment after cancellation is a divergence, the kitchen is not reopened', () => {
    expect(paymentTransition('cancelled', 'succeeded')).toEqual({ next: null, divergence: 'paid_after_cancel' })
  })

  it('cancelling an unpaid order', () => {
    expect(paymentTransition('awaiting_payment', 'canceled').next).toBe('cancelled')
    expect(paymentTransition('payment_failed', 'canceled').next).toBe('cancelled')
    expect(paymentTransition('pending', 'canceled').next).toBeNull()
  })
})

describe('canKitchenMove', () => {
  it('follows the board: pending/paid → preparing → ready → done', () => {
    expect(canKitchenMove('paid', 'preparing')).toBe(true)
    expect(canKitchenMove('preparing', 'ready')).toBe(true)
    expect(canKitchenMove('ready', 'done')).toBe(true)
  })

  it('out for delivery only for delivery orders', () => {
    expect(canKitchenMove('ready', 'out_for_delivery', 'delivery')).toBe(true)
    expect(canKitchenMove('ready', 'out_for_delivery', 'dine_in')).toBe(false)
    expect(canKitchenMove('out_for_delivery', 'done', 'delivery')).toBe(true)
  })

  it('staff never set payment states and never move backwards', () => {
    expect(canKitchenMove('awaiting_payment', 'paid')).toBe(false)
    expect(canKitchenMove('awaiting_payment', 'preparing')).toBe(false)
    expect(canKitchenMove('pending', 'payment_failed')).toBe(false)
    expect(canKitchenMove('done', 'pending')).toBe(false)
    expect(canKitchenMove('cancelled', 'preparing')).toBe(false)
  })

  it('staff may cancel an unpaid online order', () => {
    expect(canKitchenMove('awaiting_payment', 'cancelled')).toBe(true)
  })
})
