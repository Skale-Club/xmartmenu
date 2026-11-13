import { describe, expect, it } from 'vitest'
import {
  DISH_GRAB_TOLERANCE_PX,
  EDGE_PX,
  SCENE_COOLDOWN_MS,
  TWIST_START_RAD,
  dishSwipe,
  grabsDish,
  isTap,
  regionAt,
  sceneStart,
  twistActive,
  type ArZones,
} from '@/lib/ar/gesture-router'

const zones: ArZones = { width: 390, height: 844, topBottom: 76, nameBottom: 140, dockTop: 768 }

describe('regions: one region, one job', () => {
  it.each([
    [{ x: 195, y: 30 }, 'top'],
    [{ x: 195, y: 110 }, 'name'],
    [{ x: 195, y: 420 }, 'scene'],
    [{ x: 195, y: 800 }, 'dock'],
    [{ x: EDGE_PX - 1, y: 420 }, 'edge'],
    [{ x: 390 - EDGE_PX + 1, y: 420 }, 'edge'],
    [{ x: 10, y: 110 }, 'edge'], // a swipe that starts at the side edge is the phone's, not a dish change
  ])('%o is %s', (point, region) => {
    expect(regionAt(point, zones)).toBe(region)
  })
})

describe('scene gestures', () => {
  it('only taps before the dish is placed', () => {
    expect(sceneStart({ stage: 'surface', fingers: 1, onDish: false, sinceSettled: 1000 })).toBe('tap-candidate')
    expect(sceneStart({ stage: 'surface', fingers: 2, onDish: false, sinceSettled: 1000 })).toBe('none')
  })

  it('moves the dish only when the drag starts on it', () => {
    expect(sceneStart({ stage: 'placed', fingers: 1, onDish: true, sinceSettled: 1000 })).toBe('drag-dish')
    expect(sceneStart({ stage: 'placed', fingers: 1, onDish: false, sinceSettled: 1000 })).toBe('none')
  })

  it('rotates with two fingers, never resizes', () => {
    expect(sceneStart({ stage: 'placed', fingers: 2, onDish: false, sinceSettled: 1000 })).toBe('twist')
    expect(twistActive(TWIST_START_RAD / 2)).toBe(false)
    expect(twistActive(-TWIST_START_RAD)).toBe(true)
  })

  it('ignores the scene briefly after placing or changing dish', () => {
    expect(sceneStart({ stage: 'placed', fingers: 1, onDish: true, sinceSettled: SCENE_COOLDOWN_MS - 1 })).toBe('none')
    expect(sceneStart({ stage: 'surface', fingers: 1, onDish: false, sinceSettled: 0 })).toBe('none')
  })

  it('grabs the dish within its outline plus a tolerance', () => {
    const dish = { x: 200, y: 400, radius: 60 }
    expect(grabsDish({ x: 200, y: 400 }, dish)).toBe(true)
    expect(grabsDish({ x: 200 + 60 + DISH_GRAB_TOLERANCE_PX, y: 400 }, dish)).toBe(true)
    expect(grabsDish({ x: 200 + 60 + DISH_GRAB_TOLERANCE_PX + 1, y: 400 }, dish)).toBe(false)
    expect(grabsDish({ x: 200, y: 400 }, null)).toBe(false)
  })

  it('tells a tap from a drag', () => {
    expect(isTap(4, 120)).toBe(true)
    expect(isTap(12, 120)).toBe(false)
    expect(isTap(4, 500)).toBe(false)
  })
})

describe('dish swipe on the name strip', () => {
  it('changes dish only on a clear sideways swipe', () => {
    expect(dishSwipe(-60, 5)).toBe('next')
    expect(dishSwipe(70, -10)).toBe('prev')
    expect(dishSwipe(-30, 0)).toBeNull() // too short
    expect(dishSwipe(-60, 50)).toBeNull() // too diagonal
  })
})
