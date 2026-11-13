import { describe, expect, it } from 'vitest'
import { arOrderSummary, dishQuantity, lineToDecrement } from '@/components/menu/ar-cart'
import type { CartItem } from '@/components/menu/menu-utils'

function line(productId: string, name: string, quantity: number, unitPrice: number, key = `${productId}::{}`): CartItem {
  return { product: { id: productId, name } as CartItem['product'], quantity, unitPrice, selectedOptions: {}, cartKey: key }
}

const money = (value: number) => `$${value.toFixed(2)}`

describe('AR cart', () => {
  const cart = [
    line('picanha', 'Premium Picanha', 2, 29),
    line('salmon', 'Grilled Salmon', 1, 34),
    line('picanha', 'Premium Picanha', 1, 33, 'picanha::{"size":"L"}'),
  ]

  it('counts a dish across all its option combinations', () => {
    expect(dishQuantity(cart, 'picanha')).toBe(3)
    expect(dishQuantity(cart, 'salmon')).toBe(1)
    expect(dishQuantity(cart, 'tiramisu')).toBe(0)
  })

  it('takes "−" from the most recently added line of that dish', () => {
    expect(lineToDecrement(cart, 'picanha')?.cartKey).toBe('picanha::{"size":"L"}')
    expect(lineToDecrement(cart, 'tiramisu')).toBeNull()
  })

  it('lists order lines with totals', () => {
    const summary = arOrderSummary(cart, money)
    expect(summary.items).toEqual([
      { key: 'picanha::{}', name: 'Premium Picanha', qty: 2, line: '$58.00', unit: '$29.00' },
      { key: 'salmon::{}', name: 'Grilled Salmon', qty: 1, line: '$34.00', unit: '$34.00' },
      { key: 'picanha::{"size":"L"}', name: 'Premium Picanha', qty: 1, line: '$33.00', unit: '$33.00' },
    ])
    expect(summary.total).toBe('$125.00')
    expect(arOrderSummary([], money)).toEqual({ items: [], total: '$0.00' })
  })
})
