import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFeedRewritePath } from './feed-route'

test('resolves platform feed URLs for a tenant and an optional menu or location', () => {
  assert.equal(resolveFeedRewritePath('/feed/bella-vista', null), '/bella-vista')
  assert.equal(resolveFeedRewritePath('/feed/bella-vista/', null), '/bella-vista')
  assert.equal(
    resolveFeedRewritePath('/feed/bella-vista/downtown', null),
    '/bella-vista/downtown',
  )
})

test('resolves short feed URLs on a verified custom domain', () => {
  assert.equal(resolveFeedRewritePath('/feed', 'bella-vista'), '/bella-vista')
  assert.equal(resolveFeedRewritePath('/feed/', 'bella-vista'), '/bella-vista')
  assert.equal(
    resolveFeedRewritePath('/feed/downtown', 'bella-vista'),
    '/bella-vista/downtown',
  )
})

test('rejects malformed or ambiguous feed URLs', () => {
  assert.equal(resolveFeedRewritePath('/feed', null), null)
  assert.equal(resolveFeedRewritePath('/feed/bella-vista/downtown/extra', null), null)
  assert.equal(resolveFeedRewritePath('/feed/Bella-Vista', null), null)
  assert.equal(resolveFeedRewritePath('/pricing', null), null)
})
