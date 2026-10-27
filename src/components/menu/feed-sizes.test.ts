import assert from 'node:assert/strict'
import test from 'node:test'

import { feedSizes } from './feed-sizes'

const size = (id: string, name: string, base_price: number | null, price_modifier = 0) => ({ id, name, base_price, price_modifier })

const sizeGroup = {
  id: 'g1', name: 'Size', type: 'single', required: true,
  options: [size('o1', 'Slice', 15), size('o2', '5-inch Birthday Cake', 60), size('o3', '10-inch Whole Cake', 180)],
}

test('a dish whose only required choice is a size becomes one choice per size', () => {
  const sizes = feedSizes(15, [sizeGroup])
  assert.deepEqual(sizes.map(s => [s.label, s.price]), [['Slice', 15], ['5-inch Birthday Cake', 60], ['10-inch Whole Cake', 180]])
  assert.deepEqual(sizes[0].selectedOptions, { Size: 'Slice' })
  assert.deepEqual(sizes[2].editorState.singleSelections, { g1: 'o3' })
})

test('the kitchen gets the base-language names, the guest reads the localized ones', () => {
  const group = { ...sizeGroup, name: 'Tamanho', base_name: 'Size', options: [{ ...size('o1', 'Fatia', 15), base_name: 'Slice' }] }
  const [only] = feedSizes(15, [group])
  assert.equal(only.label, 'Fatia')
  assert.deepEqual(only.selectedOptions, { Size: 'Slice' })
})

test('a price modifier adds to the dish price when a size has no base price', () => {
  const group = { ...sizeGroup, options: [size('o1', 'Small', 10), size('o2', 'Large', null, 4)] }
  assert.deepEqual(feedSizes(10, [group]).map(s => s.price), [10, 14])
})

test('unavailable sizes are left out', () => {
  const group = { ...sizeGroup, options: [size('o1', 'Slice', 15), { ...size('o2', 'Whole', 180), is_available: false }] }
  assert.deepEqual(feedSizes(15, [group]).map(s => s.label), ['Slice'])
})

test('dishes with no options, or other required choices, are not sized', () => {
  assert.deepEqual(feedSizes(12, undefined), [])
  assert.deepEqual(feedSizes(12, []), [])
  const topping = { id: 'g2', name: 'Topping', type: 'multiple', required: true, options: [size('t1', 'Nuts', null, 1)] }
  assert.deepEqual(feedSizes(12, [sizeGroup, topping]), [])
  assert.deepEqual(feedSizes(12, [{ ...sizeGroup, required: false }]), [])
})
