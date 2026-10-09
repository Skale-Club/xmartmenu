import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FEED_IMAGE_SLIDE_DURATION_MS,
  FEED_VIDEO_SLIDE_DURATION_MS,
  getFeedSlideDuration,
  isProductVisibleInFeed,
  orderFeedMedia,
} from './menu-utils'

test('products are visible in the feed by default', () => {
  assert.equal(isProductVisibleInFeed({}), true)
  assert.equal(isProductVisibleInFeed({ show_in_feed: null }), true)
  assert.equal(isProductVisibleInFeed({ show_in_feed: true }), true)
})

test('products explicitly disabled are excluded from the feed', () => {
  assert.equal(isProductVisibleInFeed({ show_in_feed: false }), false)
})

test('feed media always puts videos before images and preserves display order within each type', () => {
  const media = [
    { type: 'image' as const, display_order: 0, url: 'first-image.jpg' },
    { type: 'video' as const, display_order: 4, url: 'second-video.mp4' },
    { type: 'video' as const, display_order: 1, url: 'first-video.mp4' },
    { type: 'image' as const, display_order: 2, url: 'second-image.jpg' },
  ]

  assert.deepEqual(orderFeedMedia(media).map(item => item.url), [
    'first-video.mp4',
    'second-video.mp4',
    'first-image.jpg',
    'second-image.jpg',
  ])
})

test('feed slides have explicit time limits', () => {
  assert.equal(getFeedSlideDuration('image'), FEED_IMAGE_SLIDE_DURATION_MS)
  assert.equal(getFeedSlideDuration('video'), FEED_VIDEO_SLIDE_DURATION_MS)
  assert.equal(FEED_IMAGE_SLIDE_DURATION_MS, 12_000)
  assert.equal(FEED_VIDEO_SLIDE_DURATION_MS, 22_500)
})
