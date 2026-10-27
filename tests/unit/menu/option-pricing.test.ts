import { describe, expect, it } from 'vitest'
import { halfAndHalfUnit, OptionSelectionError, resolveOptionSelection, type ServerOptionGroup } from '@/lib/menu/option-pricing'

const SIZE: ServerOptionGroup = {
  id: 'g-size', name: 'Size', type: 'single', required: true,
  options: [
    { id: 'o-small', name: 'Small', base_price: 30, price_modifier: 0 },
    { id: 'o-large', name: 'Large', base_price: null, price_modifier: 10 },
    { id: 'o-off', name: 'Giant', base_price: 80, price_modifier: 0, is_available: false },
  ],
}
const FLAVOUR: ServerOptionGroup = {
  id: 'g-half', name: 'Flavours', type: 'half_and_half', required: true,
  options: [
    { id: 'o-cheese', name: 'Cheese', base_price: 50, price_modifier: 0 },
    { id: 'o-meat', name: 'Meat', base_price: 60, price_modifier: 0 },
    { id: 'o-plain', name: 'Plain', base_price: null, price_modifier: 0 },
  ],
}
const EXTRAS: ServerOptionGroup = {
  id: 'g-extra', name: 'Extras', type: 'multiple', required: false, max_selections: 2,
  options: [
    { id: 'o-bacon', name: 'Bacon', base_price: null, price_modifier: 4 },
    { id: 'o-egg', name: 'Egg', base_price: null, price_modifier: 2 },
    { id: 'o-onion', name: 'Onion', base_price: null, price_modifier: 1 },
  ],
}

function code(fn: () => unknown): string | null {
  try { fn(); return null } catch (e) { return e instanceof OptionSelectionError ? e.code : 'other' }
}

describe('resolveOptionSelection', () => {
  it('prices a valid selection and labels it from the catalog', () => {
    const r = resolveOptionSelection(25, {
      singleSelections: { 'g-size': 'o-large' },
      multiSelections: { 'g-extra': ['o-bacon', 'o-egg'] },
    }, [SIZE, EXTRAS])
    expect(r.unit).toBe(25 + 10 + 4 + 2)
    expect(r.labels).toEqual({ Size: 'Large', Extras: 'Bacon, Egg' })
  })

  it('never prices an unknown half-and-half option as zero', () => {
    expect(code(() => resolveOptionSelection(40, { halfSelections: { 'g-half': { half1: 'nope', half2: 'nope' } } }, [FLAVOUR]))).toBe('unknown_option')
  })

  it('takes the dearer half, and a half without a price counts as the dish', () => {
    expect(resolveOptionSelection(40, { halfSelections: { 'g-half': { half1: 'o-cheese', half2: 'o-meat' } } }, [FLAVOUR]).unit).toBe(60)
    expect(halfAndHalfUnit(40, { base_price: null }, { base_price: null })).toBe(40)
    expect(resolveOptionSelection(70, { halfSelections: { 'g-half': { half1: 'o-plain', half2: 'o-cheese' } } }, [FLAVOUR]).unit).toBe(70)
  })

  it('refuses a missing required choice and an incomplete half', () => {
    expect(code(() => resolveOptionSelection(25, {}, [SIZE]))).toBe('missing_required')
    expect(code(() => resolveOptionSelection(25, null, [SIZE]))).toBe('missing_required')
    expect(code(() => resolveOptionSelection(40, { halfSelections: { 'g-half': { half1: 'o-cheese', half2: null } } }, [FLAVOUR]))).toBe('incomplete_half')
  })

  it('refuses options from another group or product, and unavailable ones', () => {
    expect(code(() => resolveOptionSelection(25, { singleSelections: { 'g-size': 'o-bacon' } }, [SIZE, EXTRAS]))).toBe('unknown_option')
    expect(code(() => resolveOptionSelection(25, { singleSelections: { 'g-size': 'o-small', 'g-other': 'o-x' } }, [SIZE]))).toBe('unknown_group')
    expect(code(() => resolveOptionSelection(25, { singleSelections: { 'g-size': 'o-off' } }, [SIZE]))).toBe('unavailable_option')
  })

  it('enforces max and duplicates on multiple choice', () => {
    expect(code(() => resolveOptionSelection(25, { multiSelections: { 'g-extra': ['o-bacon', 'o-egg', 'o-onion'] } }, [EXTRAS]))).toBe('too_many')
    expect(code(() => resolveOptionSelection(25, { multiSelections: { 'g-extra': ['o-bacon', 'o-bacon'] } }, [EXTRAS]))).toBe('duplicate_option')
  })

  it('enforces the minimum of a required multiple-choice group', () => {
    const group = { ...EXTRAS, required: true, min_selections: 2 }
    expect(code(() => resolveOptionSelection(25, { multiSelections: { 'g-extra': ['o-bacon'] } }, [group]))).toBe('too_few')
    expect(resolveOptionSelection(25, { multiSelections: { 'g-extra': ['o-bacon', 'o-onion'] } }, [group]).unit).toBe(30)
  })

  it('a product without groups costs its base price', () => {
    expect(resolveOptionSelection(19.9, null, []).unit).toBe(19.9)
  })
})
