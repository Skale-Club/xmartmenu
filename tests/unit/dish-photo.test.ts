import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import DishPhoto from '../../src/components/menu/DishPhoto'

describe('DishPhoto delivery and framing', () => {
  for (const fit of ['cover', 'feed'] as const) it(`renders ${fit} immediately with one centered responsive image`, () => {
    const html = renderToStaticMarkup(createElement(DishPhoto, {
      src: '/dish.webp', alt: 'A centered dish', sizes: '100vw', fit,
    }))
    expect([...html.matchAll(/<img\b/g)]).toHaveLength(1)
    expect(html).toContain('object-cover object-center')
    expect(html).toContain(`data-photo-presentation="${fit === 'feed' ? 'full-bleed' : 'cover'}"`)
    expect(html).not.toMatch(/object-contain|blur-|feed-photo-top|onload=/)
  })
})
