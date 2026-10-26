import { describe, expect, it } from 'vitest'
import { effectiveMultiplier, scaleOptionGroups, scalePrice, scaleProductIngredients, scaleProducts } from '@/components/menu/price-multiplier'

describe('private menu price multiplier', () => {
  it('ignores missing or invalid multipliers', () => {
    expect(effectiveMultiplier(undefined)).toBe(1)
    expect(effectiveMultiplier(0)).toBe(1)
    expect(effectiveMultiplier(-2)).toBe(1)
    expect(effectiveMultiplier('abc')).toBe(1)
    expect(effectiveMultiplier('0.9')).toBe(0.9)
  })

  it('rounds to cents like the dish price', () => {
    expect(scalePrice(10, 0.9)).toBe(9)
    expect(scalePrice(15.99, 0.85)).toBe(13.59)
    expect(scalePrice(15.99, 1)).toBe(15.99)
  })

  it('scales dish, size and add-on prices the same way', () => {
    expect(scaleProducts([{ id: 'p', price: 20, original_price: 25 }], 0.9)).toEqual([{ id: 'p', price: 18, original_price: 22.5 }])
    const groups = [{ id: 'g', options: [
      { id: 'a', base_price: 60, price_modifier: 0 },
      { id: 'b', base_price: null, price_modifier: 2 },
    ] }]
    expect(scaleOptionGroups(groups, 0.9)).toEqual([{ id: 'g', options: [
      { id: 'a', base_price: 54, price_modifier: 0 },
      { id: 'b', base_price: null, price_modifier: 1.8 },
    ] }])
    expect(scaleOptionGroups(groups, 1)).toBe(groups)
  })

  it('scales ingredient extras and add-ons', () => {
    const items = [{ extra_price_override: null, add_price_override: 3, ingredient: { default_extra_price: 2, default_add_price: 4 } }]
    expect(scaleProductIngredients(items, 0.5)).toEqual([
      { extra_price_override: null, add_price_override: 1.5, ingredient: { default_extra_price: 1, default_add_price: 2 } },
    ])
  })
})
