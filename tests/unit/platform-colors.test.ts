import { describe, expect, it } from 'vitest'
import { platformColors } from '@/lib/platform-colors'
import { contrastRatio } from '@/lib/color-utils'
import { BRAND_BASE, BRAND_PRIMARY } from '@/lib/brand'

describe('platform color authority', () => {
  it('uses the approved brand pair consistently for missing and normalized settings', () => {
    for (const configured of [undefined, null, 'invalid', BRAND_PRIMARY, ' #283f32 ']) {
      const theme = platformColors(configured)
      expect(theme.primary.toLowerCase()).toBe(BRAND_PRIMARY.toLowerCase())
      expect(theme.onPrimary).toBe(BRAND_BASE)
      expect(contrastRatio(theme.onPrimary, theme.primary)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('preserves valid custom settings while keeping their labels readable', () => {
    for (const primary of ['#184D3B', '#F5D662', '#808080', '#FF5722']) {
      const settings = Object.freeze({ primary })
      const theme = platformColors(settings.primary)
      expect(theme.primary).toBe(settings.primary)
      expect(contrastRatio(theme.onPrimary, theme.primary)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
