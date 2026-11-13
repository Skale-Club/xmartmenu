/**
 * The menu cart as the AR camera shows it (src/components/ar/WebXrDishViewer.tsx):
 * how many of this dish are in the order, which line the stepper's "−" takes
 * one from, and the order sheet's lines and total. Pure; tested in
 * tests/unit/menu/ar-cart.test.ts.
 */
import type { CartItem } from './menu-utils'

export interface ArOrderLine {
  key: string
  name: string
  qty: number
  /** Formatted line total (unit price × quantity). */
  line: string
  /** Formatted unit price. */
  unit: string
}

export interface ArOrderSummary {
  items: ArOrderLine[]
  /** Formatted order total. */
  total: string
}

/** Units of a dish in the order, across all its option combinations. */
export function dishQuantity(cart: CartItem[], productId: string): number {
  return cart.reduce((sum, item) => sum + (item.product.id === productId ? item.quantity : 0), 0)
}

/** The line "−" takes one from: the most recently added line of that dish. */
export function lineToDecrement(cart: CartItem[], productId: string): CartItem | null {
  for (let i = cart.length - 1; i >= 0; i--) {
    if (cart[i].product.id === productId && cart[i].quantity > 0) return cart[i]
  }
  return null
}

/** The order sheet: one row per cart line, and the total, formatted by `money`. */
export function arOrderSummary(cart: CartItem[], money: (value: number) => string): ArOrderSummary {
  let total = 0
  const items = cart.filter(item => item.quantity > 0).map(item => {
    const value = item.unitPrice * item.quantity
    total += value
    return { key: item.cartKey, name: item.product.name, qty: item.quantity, line: money(value), unit: money(item.unitPrice) }
  })
  return { items, total: money(total) }
}
