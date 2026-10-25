import { describe, expect, it } from 'vitest'
import { analyticsBatchSchema } from '@/lib/analytics/contracts'
import { EMPTY_UPSELL_ANALYTICS, normalizeUpsellAnalytics, upsellTakeRate } from '@/lib/analytics/upsell'

const session = {
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  menu_id: '33333333-3333-4333-8333-333333333333',
}
const PRODUCT = '44444444-4444-4444-8444-444444444444'

function batch(event: Record<string, unknown>) {
  return { session, events: [{ client_event_id: '55555555-5555-4555-8555-555555555555', occurred_at: '2026-10-25T12:00:00.000Z', ...event }] }
}

describe('upsell events in the analytics contract', () => {
  it('accepts the sequence events with source upsell', () => {
    expect(analyticsBatchSchema.safeParse(batch({ event_name: 'upsell_shown', product_id: PRODUCT, source: 'upsell' })).success).toBe(true)
    expect(analyticsBatchSchema.safeParse(batch({ event_name: 'upsell_skipped', product_id: PRODUCT, source: 'upsell' })).success).toBe(true)
    expect(analyticsBatchSchema.safeParse(batch({ event_name: 'upsell_accepted', product_id: PRODUCT, quantity: 2, source: 'upsell' })).success).toBe(true)
    expect(analyticsBatchSchema.safeParse(batch({ event_name: 'add_to_cart', product_id: PRODUCT, quantity: 1, source: 'upsell' })).success).toBe(true)
  })

  it('requires the dish and, for an accepted suggestion, the quantity', () => {
    expect(analyticsBatchSchema.safeParse(batch({ event_name: 'upsell_shown' })).success).toBe(false)
    expect(analyticsBatchSchema.safeParse(batch({ event_name: 'upsell_accepted', product_id: PRODUCT })).success).toBe(false)
  })
})

describe('normalizeUpsellAnalytics', () => {
  it('reads the RPC payload, including numeric strings', () => {
    const data = normalizeUpsellAnalytics({
      shown: 20, skipped: '5', accepted_items: 18, accepted_value: '162.50',
      top: [{ product_id: 'p1', name: 'Cola', items: 9, value: '45' }, { product_id: null, name: null, items: 1, value: 3 }],
    })
    expect(data).toEqual({
      shown: 20, skipped: 5, accepted_items: 18, accepted_value: 162.5,
      top: [{ product_id: 'p1', name: 'Cola', items: 9, value: 45 }, { product_id: null, name: 'Removed dish', items: 1, value: 3 }],
    })
    expect(upsellTakeRate(data)).toBe(0.75)
  })

  it('falls back to zeros and never reports more skips than sequences', () => {
    expect(normalizeUpsellAnalytics(null)).toEqual(EMPTY_UPSELL_ANALYTICS)
    expect(normalizeUpsellAnalytics({ shown: 2, skipped: 9 }).skipped).toBe(2)
    expect(upsellTakeRate(EMPTY_UPSELL_ANALYTICS)).toBe(0)
  })
})
