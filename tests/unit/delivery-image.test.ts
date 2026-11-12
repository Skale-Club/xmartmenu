import { describe, expect, it } from 'vitest'
import { getImageProps } from 'next/image'
import { canOptimizeImage, DeliveryImage } from '@/components/delivery-image'

describe('responsive image delivery', () => {
  it.each([
    '/icon.png',
    '/brands/celes-confections/menu.webp?v=20261029',
    'https://xmartmenu-tenant-assets.skale.club/logos/a.webp',
    'https://xmartmenu-product-images.skale.club/products/a.jpg',
    'https://project.supabase.co/storage/v1/object/public/blog/a.png',
    'https://images.unsplash.com/photo-1?w=1200',
  ])('optimizes an allowed raster source: %s', src => {
    expect(canOptimizeImage(src)).toBe(true)
  })

  it.each([
    'https://legacy.example.com/logo.png',
    'https://xmartmenu-tenant-assets.skale.club.evil.example/logo.png',
    'http://xmartmenu-tenant-assets.skale.club/logo.png',
    'https://project.supabase.co/private/logo.png',
    'https://nested.project.supabase.co/storage/v1/object/public/logo.png',
    'https://images.unsplash.com:8443/photo.jpg',
    '/logo.SVG?v=2',
    'https://xmartmenu-tenant-assets.skale.club/logo.svg?v=2',
    '/icon.png?v=unsupported',
    'blob:https://example.com/123',
    'data:image/png;base64,abc',
  ])('preserves direct delivery for unsupported sources and vectors: %s', src => {
    expect(canOptimizeImage(src)).toBe(false)
  })

  it('retains logo dimensions and generates small density variants', () => {
    const image = DeliveryImage({ src: '/icon.png', alt: '', width: 48, height: 48, sizes: '48px' })
    const { props } = getImageProps(image.props)
    expect(props).toMatchObject({ width: 48, height: 48, sizes: '48px' })
    expect(props.srcSet).toContain('w=48&')
    expect(props.srcSet).toContain('w=96&')
  })

  it('retains cover layout sizing for mobile source selection', () => {
    const sizes = '(max-width: 767px) calc(100vw - 32px), 720px'
    const image = DeliveryImage({ src: '/cover.webp', alt: '', width: 1200, height: 675, sizes })
    const { props } = getImageProps(image.props)
    expect(props).toMatchObject({ width: 1200, height: 675, sizes })
    expect(props.srcSet).toContain('640w')
  })

  it('does not send arbitrary legacy URLs to the Next optimizer', () => {
    const src = 'https://legacy.example.com/logo.png'
    const image = DeliveryImage({ src, alt: '', width: 48, height: 48, sizes: '48px' })
    const { props } = getImageProps(image.props)
    expect(props.src).toBe(src)
    expect(props.srcSet).toBeUndefined()
  })
})
