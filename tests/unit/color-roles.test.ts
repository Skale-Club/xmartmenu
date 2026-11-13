import { describe, expect, it } from 'vitest'
import { computePrimaryForeground, contrastRatio, readableTextColor, relativeLuminance, safeCssColor, visibleFillColor } from '@/lib/color-utils'

const tenants = [
  { primary: '#1A1A2E', accent: '#E94560' },
  { primary: '#264653', accent: '#2A9D8F' },
  { primary: '#582F0E', accent: '#B28A58' },
]

describe('tenant colour roles', () => {
  it('keeps configured values intact while deriving readable prices on menu and sheet surfaces', () => {
    const original = JSON.stringify(tenants)
    for (const tenant of tenants) {
      const price = readableTextColor(tenant.accent)
      expect(contrastRatio(price, '#fafaf9')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(price, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(safeCssColor(tenant.primary)).toBe(tenant.primary)
      expect(safeCssColor(tenant.accent)).toBe(tenant.accent)
    }
    expect(JSON.stringify(tenants)).toBe(original)
    expect(readableTextColor('#283F32')).toBe('#283F32')
  })

  it('makes normal-sized labels readable across tenant, service and medium/light fills', () => {
    for (const fill of [...tenants.flatMap(t => [t.primary, t.accent]), '#FF5722', '#808080', '#777777', '#FFD700', '#25D366', '#fff', '#000']) {
      expect(contrastRatio(computePrimaryForeground(fill), fill), fill).toBeGreaterThanOrEqual(4.5)
    }
    for (let channel = 0; channel <= 255; channel++) {
      const fill = '#' + channel.toString(16).padStart(2, '0').repeat(3)
      expect(contrastRatio(computePrimaryForeground(fill), fill), fill).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('handles shorthand alpha and full alpha consistently against the actual surface', () => {
    for (const surface of ['#ffffff', '#151819']) {
      expect(relativeLuminance('#f008', surface)).toBeCloseTo(relativeLuminance('#ff000088', surface), 10)
      for (const fill of ['#f008', '#ff000088', '#0000', '#ffffff00']) {
        expect(contrastRatio(computePrimaryForeground(fill, surface), fill, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(readableTextColor(fill, surface), surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps dark-sheet actions distinguishable when both tenant colours are dark', () => {
    const fill = visibleFillColor('#09090b', '#18181b', '#232627')
    expect(contrastRatio(fill, '#232627')).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(computePrimaryForeground(fill, '#151819'), fill, '#151819')).toBeGreaterThanOrEqual(4.5)
    expect(visibleFillColor('#ffffff', '#e94560')).toBe('#ffffff')
  })

  it('fails safely for malformed colours rather than emitting an invalid CSS colour', () => {
    for (const value of ['red', '#12', 'transparent', '</style>']) {
      expect(safeCssColor(value, '#09090b')).toBe('#09090b')
      expect(computePrimaryForeground(value)).toBe('#ffffff')
      expect(readableTextColor(value)).toBe('#09090b')
    }
  })
})
