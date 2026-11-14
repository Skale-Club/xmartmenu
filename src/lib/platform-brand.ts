/** Versioned platform assets from the approved, unchanged Xprout v7 master. */
export const PLATFORM_BRAND_ASSETS = {
  icon: '/brand/xprout/v1/icon-512.png',
  icon192: '/brand/xprout/v1/icon-192.png',
  maskable192: '/brand/xprout/v1/icon-maskable-192.png',
  maskable512: '/brand/xprout/v1/icon-maskable-512.png',
  apple: '/brand/xprout/v1/apple-touch-icon.png',
  favicon16: '/brand/xprout/v1/favicon-16.png',
  favicon32: '/brand/xprout/v1/favicon-32.png',
  faviconIco: '/brand/xprout/v1/favicon.ico',
  horizontalForest: '/brand/xprout/v1/xprout-horizontal-forest.svg',
  horizontalIvory: '/brand/xprout/v1/xprout-horizontal-ivory.svg',
  symbolForest: '/brand/xprout/v1/xprout-symbol-forest.svg',
  symbolIvory: '/brand/xprout/v1/xprout-symbol-ivory.svg',
  social: '/brand/xprout/v1/social-card-1200x630.webp',
  socialPng: '/brand/xprout/v1/social-card-1200x630.png',
} as const

/** Explicit configuration wins; only an absent logo selects the platform default. */
export function platformLogoUrl(configured?: string | null): string {
  return configured?.trim() || PLATFORM_BRAND_ASSETS.icon
}

/** Used to select the approved signature when the configured icon is our default. */
export function isDefaultPlatformLogo(configured?: string | null): boolean {
  if (!configured?.trim()) return true
  if (configured === PLATFORM_BRAND_ASSETS.icon) return true
  try {
    const url = new URL(configured)
    return url.origin === 'https://xprout.app' && url.pathname === PLATFORM_BRAND_ASSETS.icon
      && !url.search && !url.hash
  } catch { return false }
}
