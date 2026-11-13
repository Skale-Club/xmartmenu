import { describe, expect, it } from 'vitest'
import * as gestures from '@/lib/ar/gestures'
import {
  angle,
  angleDelta,
  distance,
  isHorizontalSurface,
  twistYaw,
} from '@/lib/ar/gestures'

describe('real size only', () => {
  it('offers no resize math: the dish always shows at its real size', () => {
    expect(Object.keys(gestures)).not.toEqual(expect.arrayContaining(['pinchScale']))
    expect(Object.keys(gestures).some(name => /scale/i.test(name))).toBe(false)
  })
})

describe('twist', () => {
  it('measures the shortest turn between two angles', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2)
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2)
  })

  it('turns the dish against the screen angle (screen y points down)', () => {
    expect(twistYaw(0, 0, 0.5)).toBeCloseTo(-0.5)
    expect(twistYaw(1, 0.2, 0)).toBeCloseTo(1.2)
  })

  it('reads finger geometry', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(angle({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2)
  })
})

describe('surfaces', () => {
  it('accepts only surfaces that face up', () => {
    expect(isHorizontalSurface(1)).toBe(true)
    expect(isHorizontalSurface(0.95)).toBe(true)
    expect(isHorizontalSurface(0.5)).toBe(false)
    expect(isHorizontalSurface(-1)).toBe(false)
  })
})
