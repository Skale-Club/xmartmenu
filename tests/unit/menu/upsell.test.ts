import { describe, expect, it } from 'vitest'
import type { Product } from '@/types/database'
import { buildUpsellSteps, canQuickAdd, parseCourse } from '@/components/menu/upsell'

const categories = [
  { id: 'c-main', course: 'main' },
  { id: 'c-side', course: 'side' },
  { id: 'c-drink', course: 'drink' },
  { id: 'c-dessert', course: 'dessert' },
  { id: 'c-other', course: null },
]

function dish(id: string, category_id: string | null, extra: Partial<Product> = {}): Product {
  return { id, category_id, name: id, price: 10, is_featured: false, upsell_product_ids: [], ...extra } as Product
}

const burger = dish('burger', 'c-main')
const fries = dish('fries', 'c-side')
const salad = dish('salad', 'c-side')
const cola = dish('cola', 'c-drink')
const juice = dish('juice', 'c-drink', { is_featured: true })
const brownie = dish('brownie', 'c-dessert')
const sticker = dish('sticker', 'c-other')
const menu = [burger, fries, salad, cola, juice, brownie, sticker]

const kinds = (steps: ReturnType<typeof buildUpsellSteps>) => steps.map(s => `${s.kind}:${s.products.map(p => p.id).join(',')}`)

describe('buildUpsellSteps', () => {
  it('follows a main course with sides, drinks and desserts, featured first', () => {
    const steps = buildUpsellSteps({ added: burger, cartProductIds: ['burger'], products: menu, categories })
    expect(kinds(steps)).toEqual(['side:fries,salad', 'drink:juice,cola', 'dessert:brownie'])
  })

  it('skips a course the guest already has', () => {
    const steps = buildUpsellSteps({ added: burger, cartProductIds: ['burger', 'cola', 'brownie'], products: menu, categories })
    expect(kinds(steps)).toEqual(['side:fries,salad'])
  })

  it('offers nothing for drinks, desserts or dishes outside a course', () => {
    for (const added of [cola, brownie, sticker, fries]) {
      expect(buildUpsellSteps({ added, cartProductIds: [added.id], products: menu, categories })).toEqual([])
    }
  })

  it('shows hand-picked dishes first and never repeats them', () => {
    const picked = { ...burger, upsell_product_ids: ['cola', 'ghost', 'fries'] }
    const steps = buildUpsellSteps({ added: picked, cartProductIds: ['burger'], products: menu, categories })
    expect(kinds(steps)).toEqual(['pairs:cola,fries', 'side:salad', 'drink:juice'])
  })

  it('works with hand-picked dishes alone, without courses', () => {
    const picked = { ...sticker, upsell_product_ids: ['brownie'] }
    const steps = buildUpsellSteps({ added: picked, cartProductIds: ['sticker'], products: menu, categories: [] })
    expect(kinds(steps)).toEqual(['pairs:brownie'])
  })

  it('caps suggestions per step and the number of steps', () => {
    const drinks = Array.from({ length: 6 }, (_, i) => dish(`d${i}`, 'c-drink'))
    const picked = { ...burger, upsell_product_ids: ['brownie'] }
    const steps = buildUpsellSteps({ added: picked, cartProductIds: ['burger'], products: [burger, fries, ...drinks, brownie], categories, maxPerStep: 3 })
    expect(steps).toHaveLength(3)
    expect(steps.map(s => s.kind)).toEqual(['pairs', 'side', 'drink'])
    expect(steps[2].products).toHaveLength(3)
  })

  it('leaves out dishes already in the cart', () => {
    const steps = buildUpsellSteps({ added: burger, cartProductIds: ['burger', 'fries'], products: menu, categories })
    expect(kinds(steps)[0]).toBe('drink:juice,cola')
  })
})

describe('helpers', () => {
  it('parses courses', () => {
    expect(parseCourse('drink')).toBe('drink')
    expect(parseCourse('starter')).toBeNull()
    expect(parseCourse(null)).toBeNull()
  })

  it('quick-adds only dishes without required choices', () => {
    expect(canQuickAdd(undefined)).toBe(true)
    expect(canQuickAdd([{ required: false, min_selections: 0 }])).toBe(true)
    expect(canQuickAdd([{ required: true, min_selections: 1 }])).toBe(false)
    expect(canQuickAdd([{ required: false, min_selections: 2 }])).toBe(false)
  })
})
