import { describe, expect, it } from 'vitest'
import type { Product } from '@/types/database'
import {
  addWaiterLine,
  changeWaiterLine,
  needsDishSheet,
  plainLineKey,
  quantityOfProduct,
  waiterCartTotal,
  waiterOrderItems,
} from '@/app/(public)/[slug]/waiter/waiter-cart'

const cake = { id: 'cake', name: 'Bolo', base_name: 'Cake', price: 0 } as unknown as Product
const coffee = { id: 'coffee', name: 'Coffee', price: 4 } as unknown as Product
const editorState = { singleSelections: { g1: 'o2' }, halfSelections: {}, multiSelections: {}, ingredientSteppers: {}, addedIngredients: [], note: '' }

describe('waiter cart', () => {
  it('keeps a dish with different choices on separate lines and merges identical ones', () => {
    let cart = addWaiterLine([], { product: cake, quantity: 1, selectedOptions: { Size: '5-inch' }, unitPrice: 60, editorState })
    cart = addWaiterLine(cart, { product: cake, quantity: 2, selectedOptions: { Size: '5-inch' }, unitPrice: 60, editorState })
    cart = addWaiterLine(cart, { product: cake, quantity: 1, selectedOptions: { Size: 'Slice' }, unitPrice: 15 })
    cart = addWaiterLine(cart, { product: cake, quantity: 1, selectedOptions: { Size: 'Slice' }, unitPrice: 15, note: 'birthday' })
    expect(cart.map(l => l.quantity)).toEqual([3, 1, 1])
    expect(quantityOfProduct(cart, 'cake')).toBe(5)
    expect(waiterCartTotal(cart)).toBe(210)
  })

  it('changes and removes lines', () => {
    let cart = addWaiterLine([], { product: coffee, quantity: 1, selectedOptions: {}, unitPrice: 4 })
    const key = plainLineKey(coffee)
    expect(cart[0].key).toBe(key)
    cart = changeWaiterLine(cart, key, 1)
    expect(cart[0].quantity).toBe(2)
    cart = changeWaiterLine(cart, key, -2)
    expect(cart).toEqual([])
  })

  it('sends items in the guest checkout shape, with the options the server prices', () => {
    const cart = addWaiterLine([], { product: cake, quantity: 1, selectedOptions: { Size: '5-inch' }, unitPrice: 60, note: ' candles ', editorState })
    expect(waiterOrderItems(cart)).toEqual([{
      product_id: 'cake',
      product_name: 'Cake',
      quantity: 1,
      unit_price: 60,
      notes: 'candles',
      selected_options: { Size: '5-inch' },
      ingredient_modifications: null,
      editor_state: editorState,
    }])
  })

  it('opens the dish sheet only when there are choices to make', () => {
    expect(needsDishSheet(1, 0, { ingredientCustomization: false })).toBe(true)
    expect(needsDishSheet(0, 3, { ingredientCustomization: true })).toBe(true)
    expect(needsDishSheet(0, 3, { ingredientCustomization: false })).toBe(false)
    expect(needsDishSheet(0, 0, { ingredientCustomization: true })).toBe(false)
  })
})
