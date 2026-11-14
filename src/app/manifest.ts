import { BRAND_BASE, BRAND_NAME, BRAND_PRIMARY } from '@/lib/brand'
import type { MetadataRoute } from 'next'
import { PLATFORM_BRAND_ASSETS } from '@/lib/platform-brand'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: 'A digital menu platform built for restaurant service, QR code ordering, and menu operations.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND_BASE,
    theme_color: BRAND_PRIMARY,
    icons: [
      { src: PLATFORM_BRAND_ASSETS.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: PLATFORM_BRAND_ASSETS.icon, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: PLATFORM_BRAND_ASSETS.maskable192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: PLATFORM_BRAND_ASSETS.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
