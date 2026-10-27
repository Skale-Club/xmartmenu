/**
 * Order status transitions, in one place (EX-04). Two kinds of actors move an
 * order and they never overlap:
 *
 *   payment  — only the payment provider's evidence (a webhook, or the
 *              PaymentIntent read back from Stripe): awaiting_payment,
 *              payment_failed, paid. Staff never set these by hand.
 *   kitchen  — staff on the order board: preparing, ready, out_for_delivery,
 *              done, cancelled.
 *
 * A late payment event never moves an order the kitchen already advanced, and
 * a payment confirmed after the order was cancelled is a divergence to
 * reconcile, not a reason to reopen the kitchen.
 */

export const ORDER_STATUSES = [
  'awaiting_payment', 'pending', 'paid', 'payment_failed',
  'preparing', 'ready', 'out_for_delivery', 'done', 'cancelled',
] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

const KITCHEN_MOVES: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_payment: ['cancelled'],
  payment_failed: ['cancelled'],
  pending: ['preparing', 'cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['done', 'out_for_delivery', 'cancelled'],
  out_for_delivery: ['done', 'cancelled'],
  done: [],
  cancelled: [],
}

/** May staff move an order from `from` to `to`? Delivery-only steps need a delivery order. */
export function canKitchenMove(from: string, to: string, orderType?: string | null): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false
  if (to === 'out_for_delivery' && orderType !== 'delivery') return false
  return KITCHEN_MOVES[from].includes(to)
}

export type PaymentSignal = 'succeeded' | 'failed' | 'canceled'

export interface PaymentTransition {
  /** New status, or null when this signal changes nothing for this order. */
  next: OrderStatus | null
  /** Set when money and order disagree and a person has to look. */
  divergence?: 'paid_after_cancel'
}

export function paymentTransition(current: string, signal: PaymentSignal): PaymentTransition {
  switch (signal) {
    case 'succeeded':
      // A failed attempt can still be paid with the same intent afterwards.
      if (current === 'awaiting_payment' || current === 'pending' || current === 'payment_failed') return { next: 'paid' }
      if (current === 'cancelled') return { next: null, divergence: 'paid_after_cancel' }
      return { next: null } // already paid or the kitchen moved it on: never regress
    case 'failed':
      if (current === 'awaiting_payment' || current === 'pending') return { next: 'payment_failed' }
      return { next: null } // a stale failure never undoes a payment
    case 'canceled':
      if (current === 'awaiting_payment' || current === 'payment_failed') return { next: 'cancelled' }
      return { next: null }
  }
}
