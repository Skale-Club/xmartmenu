import { describe, expect, it } from 'vitest'
import { relativeLuminance } from '@/lib/color-utils'

describe('relativeLuminance', () => {
  it('measures black, white and brand colours', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#fff')).toBeCloseTo(1)
    expect(relativeLuminance('#1a1a2e')).toBeLessThan(0.06)
    expect(relativeLuminance('#e94560')).toBeGreaterThan(0.06)
  })

  it('returns 0 for values that are not hex colours', () => {
    expect(relativeLuminance('red')).toBe(0)
    expect(relativeLuminance('#12345')).toBe(0)
  })
})
