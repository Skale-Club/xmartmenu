import assert from 'node:assert/strict'
import test from 'node:test'

import { isProductVisibleInFeed } from './menu-utils'

test('products are visible in the feed by default', () => {
  assert.equal(isProductVisibleInFeed({}), true)
  assert.equal(isProductVisibleInFeed({ show_in_feed: null }), true)
  assert.equal(isProductVisibleInFeed({ show_in_feed: true }), true)
})

test('products explicitly disabled are excluded from the feed', () => {
  assert.equal(isProductVisibleInFeed({ show_in_feed: false }), false)
})
