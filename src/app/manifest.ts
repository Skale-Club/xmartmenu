import { BRAND_BASE, BRAND_NAME, BRAND_PRIMARY } from '@/lib/brand'
import type { MetadataRoute } from 'next'

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
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
