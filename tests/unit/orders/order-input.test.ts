import { describe, expect, it } from 'vitest'
import { createOrderSchema, describeInputError, orderFingerprint, parseIdempotencyKey } from '@/lib/orders/order-input'
import { idempotencyKeyFor } from '@/lib/orders/idempotency-client'

const TENANT = 'b0000000-0000-4000-8000-000000000003'
const PRODUCT = 'e0000000-0000-4000-8000-000000000031'

const valid = () => ({
  tenant_id: TENANT,
  customer_name: 'Ana',
  customer_phone: '+5511900000000',
  items: [{ product_id: PRODUCT, quantity: 2, unit_price: 0.01, product_name: 'anything' }],
})

function errorOf(body: unknown): string | null {
  const r = createOrderSchema.safeParse(body)
  return r.success ? null : describeInputError(r.error)
}

describe('createOrderSchema', () => {
  it('accepts the payload current clients send', () => {
    expect(errorOf(valid())).toBeNull()
    expect(errorOf({ ...valid(), order_type: '', table_id: undefined, menu_id: null, tip_cents: 0 })).toBeNull()
  })

  it('bounds quantities, cart size and ids', () => {
    expect(errorOf({ ...valid(), items: [{ product_id: PRODUCT, quantity: 0 }] })).toBe('Invalid item quantity')
    expect(errorOf({ ...valid(), items: [{ product_id: PRODUCT, quantity: 1.5 }] })).toBe('Invalid item quantity')
    expect(errorOf({ ...valid(), items: [{ product_id: 'not-a-uuid', quantity: 1 }] })).toBe('Invalid item')
    expect(errorOf({ ...valid(), items: Array.from({ length: 51 }, () => ({ product_id: PRODUCT, quantity: 1 })) })).toBe('Too many items in one order')
    expect(errorOf({ ...valid(), items: [] })).toBe('At least one item is required')
  })

  it('rejects blank names, absurd strings, bad order types and tips', () => {
    expect(errorOf({ ...valid(), customer_name: '   ' })).toBe('Customer name is required')
    expect(errorOf({ ...valid(), customer_name: 'x'.repeat(500) })).not.toBeNull()
    expect(errorOf({ ...valid(), order_type: 'takeaway' })).toBe('Invalid order type')
    expect(errorOf({ ...valid(), tip_cents: -5 })).not.toBeNull()
    expect(errorOf({ ...valid(), location_id: 'x' })).not.toBeNull()
  })

  it('caps ingredient quantities so a line cannot go negative', () => {
    const item = { product_id: PRODUCT, quantity: 1, ingredient_modifications: { removed: [], extras: [{ ingredient_id: PRODUCT, qty: -3 }], added: [] } }
    expect(errorOf({ ...valid(), items: [item] })).toBe('Invalid item')
  })
})

describe('idempotency', () => {
  it('accepts only bounded opaque keys', () => {
    expect(parseIdempotencyKey('0d6f1c2e-6d0b-4b2e-9a51-2a7d1f6f2b11')).toBe('0d6f1c2e-6d0b-4b2e-9a51-2a7d1f6f2b11')
    expect(parseIdempotencyKey('short')).toBeNull()
    expect(parseIdempotencyKey('has spaces in it')).toBeNull()
    expect(parseIdempotencyKey(null)).toBeNull()
  })

  it('fingerprints ignore key order and change with the order', () => {
    expect(orderFingerprint({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(orderFingerprint({ b: [1, { d: 3, c: 2 }], a: 1 }))
    expect(orderFingerprint({ a: 1 })).not.toBe(orderFingerprint({ a: 2 }))
  })

  it('the browser reuses the key for the same cart only', () => {
    const first = idempotencyKeyFor(null, { items: [1] })
    expect(idempotencyKeyFor(first, { items: [1] }).key).toBe(first.key)
    expect(idempotencyKeyFor(first, { items: [1, 2] }).key).not.toBe(first.key)
  })
})
