import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ANALYTICS_BATCH_SIZE,
  analyticsBatchSchema,
  validateEventTimes,
} from './contracts'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const MENU_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const EVENT_ID = '55555555-5555-4555-8555-555555555555'

function validBatch() {
  return {
    session: {
      id: SESSION_ID,
      tenant_id: TENANT_ID,
      menu_id: MENU_ID,
      device_class: 'mobile',
      entry_source: 'qr',
      is_test: false,
    },
    events: [{
      client_event_id: EVENT_ID,
      event_name: 'product_impression',
      occurred_at: '2026-10-08T12:00:00.000Z',
      product_id: PRODUCT_ID,
      source: 'grid',
    }],
  }
}

test('accepts a schema-controlled analytics batch', () => {
  assert.equal(analyticsBatchSchema.safeParse(validBatch()).success, true)
})

test('rejects server-only order outcome events from public clients', () => {
  const batch = validBatch()
  batch.events[0] = { ...batch.events[0], event_name: 'order_completed' } as never
  assert.equal(analyticsBatchSchema.safeParse(batch).success, false)
})

test('rejects arbitrary properties that could carry PII', () => {
  const batch = validBatch()
  batch.events[0] = { ...batch.events[0], customer_email: 'guest@example.com' } as never
  assert.equal(analyticsBatchSchema.safeParse(batch).success, false)
})

test('requires product ids for product events', () => {
  const batch = validBatch()
  const eventWithoutProduct = { ...batch.events[0] } as Partial<typeof batch.events[0]>
  delete eventWithoutProduct.product_id
  batch.events[0] = eventWithoutProduct as never
  assert.equal(analyticsBatchSchema.safeParse(batch).success, false)
})

test('enforces the public batch size cap', () => {
  const batch = validBatch()
  batch.events = Array.from({ length: MAX_ANALYTICS_BATCH_SIZE + 1 }, (_, index) => ({
    ...batch.events[0],
    client_event_id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
  }))
  assert.equal(analyticsBatchSchema.safeParse(batch).success, false)
})

test('accepts recent events and rejects stale or future events', () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z')
  const recent = analyticsBatchSchema.parse(validBatch()).events
  assert.equal(validateEventTimes(recent, now), true)

  const stale = [{ ...recent[0], occurred_at: '2026-10-07T11:59:59.000Z' }]
  const future = [{ ...recent[0], occurred_at: '2026-10-08T12:05:01.000Z' }]
  assert.equal(validateEventTimes(stale, now), false)
  assert.equal(validateEventTimes(future, now), false)
})
