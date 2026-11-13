import { describe, expect, it } from 'vitest'
import { getFeedSlides, getProductImages, isFeedPortrait } from '../../src/components/menu/menu-utils'
import type { Product } from '../../src/types/database'

const product = { image_url: '/main.webp', image_urls: ['/gallery.webp'], feed_image_url: '/portrait.webp' } as Product
const media = [
  { type: 'image' as const, url: '/media.webp', display_order: 0 },
  { type: 'video' as const, url: '/video.mp4', display_order: 1 },
]
describe('dedicated feed photo source', () => {
  it('uses the authored portrait only for feed stills and preserves videos', () => {
    expect(getFeedSlides(product, media, ['/extra.webp'])).toEqual([
      { type: 'video', url: '/video.mp4' }, { type: 'image', url: '/portrait.webp' },
    ])
    expect(getProductImages(product)).toEqual(['/gallery.webp', '/main.webp'])
  })
  it('falls back to the original ordered media or main gallery when no portrait is set', () => {
    for (const feed_image_url of [undefined, null, '  ']) {
      const fallback = { ...product, feed_image_url }
      expect(getFeedSlides(fallback, media)).toEqual([
        { type: 'video', url: '/video.mp4' }, { type: 'image', url: '/media.webp' },
      ])
      expect(getFeedSlides(fallback, [], ['/extra.webp'])).toEqual([
        { type: 'image', url: '/gallery.webp' }, { type: 'image', url: '/main.webp' }, { type: 'image', url: '/extra.webp' },
      ])
    }
  })
})

it('selects the shared portrait crop by the explicit source URL, preserving legacy and main roles', () => {
  const source = { feed_image_url: '  /portrait.webp  ' }
  expect(isFeedPortrait(source, '/portrait.webp')).toBe(true)
  expect(isFeedPortrait(source, '/gallery.webp')).toBe(false)
  expect(isFeedPortrait({ feed_image_url: null }, '/portrait.webp')).toBe(false)
  expect(isFeedPortrait({ feed_image_url: ' ' }, undefined)).toBe(false)
  expect(isFeedPortrait({}, '/portrait.webp')).toBe(false)
})
