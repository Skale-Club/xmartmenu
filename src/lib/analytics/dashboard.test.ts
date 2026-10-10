import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRecommendations,
  enrichProductAnalytics,
  normalizeOverview,
  safeRate,
  type ProductAnalyticsRow,
} from './dashboard'

const baseProduct: ProductAnalyticsRow = {
  product_id: '11111111-1111-4111-8111-111111111111',
  product_name: 'House burger',
  impression_sessions: 50,
  engaged_sessions: 40,
  detail_sessions: 20,
  add_sessions: 12,
  remove_sessions: 2,
  attention_ms: 240_000,
  purchased_sessions: 8,
  purchased_quantity: 10,
  revenue: 190,
}

test('safeRate handles empty denominators and clamps invalid funnel ratios', () => {
  assert.equal(safeRate(5, 0), 0)
  assert.equal(safeRate(12, 10), 1)
  assert.equal(safeRate(2, 10), 0.2)
})

test('product metrics use session-level denominators', () => {
  const result = enrichProductAnalytics(baseProduct)
  assert.equal(result.add_rate, 0.24)
  assert.equal(result.purchase_rate, 0.16)
  assert.equal(result.avg_attention_seconds, 6)
  assert.equal(result.has_enough_data, true)
})

test('recommendations suppress products below the sample threshold', () => {
  const product = enrichProductAnalytics({ ...baseProduct, impression_sessions: 10 })
  assert.deepEqual(buildRecommendations([product]), [])
})

test('recommendations expose evidence for deterministic rules', () => {
  const product = enrichProductAnalytics(baseProduct)
  const recommendations = buildRecommendations([product])
  assert.ok(recommendations.some(item => item.id.endsWith(':exposure')))
  assert.ok(recommendations.every(item => item.evidence.length > 0 && item.action.length > 0))
})

test('overview normalization converts Postgres numeric strings', () => {
  const overview = normalizeOverview({ sessions: '12', revenue: '45.20' })
  assert.equal(overview.sessions, 12)
  assert.equal(overview.revenue, 45.2)
  assert.equal(overview.completed_orders, 0)
})
