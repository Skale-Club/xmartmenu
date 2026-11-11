import { describe, expect, it } from 'vitest'
import {
  MAX_DISH_SCALE,
  MIN_DISH_SCALE,
  angle,
  angleDelta,
  clampDishScale,
  distance,
  isHorizontalSurface,
  pinchScale,
  scalePercent,
  twistYaw,
} from '@/lib/ar/gestures'

describe('clampDishScale', () => {
  it('keeps the dish between 50 % and 300 %', () => {
    expect(clampDishScale(0.1)).toBe(MIN_DISH_SCALE)
    expect(clampDishScale(9)).toBe(MAX_DISH_SCALE)
    expect(clampDishScale(1.6)).toBe(1.6)
  })

  it('snaps to the real size when close to it', () => {
    expect(clampDishScale(1.04)).toBe(1)
    expect(clampDishScale(0.96)).toBe(1)
    expect(clampDishScale(1.1)).toBe(1.1)
  })

  it('falls back to real size on nonsense', () => {
    expect(clampDishScale(Number.NaN)).toBe(1)
    expect(clampDishScale(0)).toBe(1)
    expect(clampDishScale(-2)).toBe(1)
  })
})

describe('pinchScale', () => {
  it('scales by how far the fingers moved apart', () => {
    expect(pinchScale(1, 100, 150)).toBe(1.5)
    expect(pinchScale(2, 100, 50)).toBe(1)
    expect(pinchScale(1, 100, 1000)).toBe(MAX_DISH_SCALE)
  })

  it('ignores a zero start distance', () => {
    expect(pinchScale(1.5, 0, 100)).toBe(1.5)
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

describe('labels and surfaces', () => {
  it('rounds the size chip to 5 %', () => {
    expect(scalePercent(1)).toBe(100)
    expect(scalePercent(1.33)).toBe(135)
    expect(scalePercent(0.52)).toBe(50)
  })

  it('accepts only surfaces that face up', () => {
    expect(isHorizontalSurface(1)).toBe(true)
    expect(isHorizontalSurface(0.95)).toBe(true)
    expect(isHorizontalSurface(0.5)).toBe(false)
    expect(isHorizontalSurface(-1)).toBe(false)
  })
})
