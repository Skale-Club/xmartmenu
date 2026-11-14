import type { Metadata } from 'next'
import { isDefaultPlatformLogo, PLATFORM_BRAND_ASSETS } from './platform-brand'

/** Only the platform default changes; configured third-party icons stay explicit. */
export function platformMetadataIcons(configured?: string | null): Metadata['icons'] {
  if (!isDefaultPlatformLogo(configured)) return {
    icon: configured!.trim(), shortcut: configured!.trim(), apple: PLATFORM_BRAND_ASSETS.apple,
  }
  return {
    icon: [
      { url: PLATFORM_BRAND_ASSETS.faviconIco, sizes: 'any' },
      { url: PLATFORM_BRAND_ASSETS.favicon32, sizes: '32x32', type: 'image/png' },
      { url: PLATFORM_BRAND_ASSETS.favicon16, sizes: '16x16', type: 'image/png' },
    ],
    shortcut: PLATFORM_BRAND_ASSETS.faviconIco,
    apple: [{ url: PLATFORM_BRAND_ASSETS.apple, sizes: '180x180', type: 'image/png' }],
  }
}
