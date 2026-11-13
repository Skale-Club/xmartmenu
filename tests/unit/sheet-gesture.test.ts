import { describe, expect, it } from 'vitest'
import { SHEET_CLOSE_DISTANCE, scrimOpacity, sheetOffset, sheetRelease } from '@/lib/sheet-gesture'

describe('sheet release (iOS-style)', () => {
  it('closes on a long drag down or a quick fling', () => {
    expect(sheetRelease(SHEET_CLOSE_DISTANCE + 1, 600, false)).toBe('close')
    expect(sheetRelease(60, 50, false)).toBe('close')
  })

  it('snaps back on a short slow drag', () => {
    expect(sheetRelease(30, 400, false)).toBe('stay')
    expect(sheetRelease(-20, 300, false)).toBe('stay')
  })

  it('expands on a drag up and collapses from the large size on a drag down', () => {
    expect(sheetRelease(-80, 300, false)).toBe('expand')
    expect(sheetRelease(-80, 300, true)).toBe('stay')
    expect(sheetRelease(80, 600, true)).toBe('collapse')
    expect(sheetRelease(SHEET_CLOSE_DISTANCE * 1.5 + 1, 900, true)).toBe('close')
  })

  it('follows the finger down, resists going up, and fades the scrim', () => {
    expect(sheetOffset(50)).toBe(50)
    expect(sheetOffset(-100)).toBeCloseTo(-30)
    expect(scrimOpacity(0)).toBe(1)
    expect(scrimOpacity(-50)).toBe(1)
    expect(scrimOpacity(200)).toBeCloseTo(0.5)
    expect(scrimOpacity(800)).toBe(0)
  })
})
