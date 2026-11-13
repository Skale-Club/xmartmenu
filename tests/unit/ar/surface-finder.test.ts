import { describe, expect, it } from 'vitest'
import {
  PATCH_MAX_RADIUS,
  PATCH_MIN_RADIUS,
  SCANNING_HINT_DELAY_MS,
  SCANNING_HINT_EVERY_MS,
  SURFACE_ACQUIRE_MS,
  SURFACE_RELEASE_MS,
  createSurfaceTracker,
  isTrackingLost,
  offsetDirections,
  patchRadius,
  sameTableExtent,
  scanningHintIndex,
  smoothToward,
} from '@/lib/ar/surface-finder'

describe('offset rays', () => {
  it('spreads unit rays on each ring around the forward axis', () => {
    const rays = offsetDirections([0.05, 0.1], 6)
    expect(rays).toHaveLength(12)
    for (const ray of rays) {
      expect(Math.hypot(ray.x, ray.y, ray.z)).toBeCloseTo(1)
      expect(ray.z).toBeLessThan(0)
    }
    // The outer ring points farther from the centre than the inner one.
    expect(Math.hypot(rays[6].x, rays[6].y)).toBeGreaterThan(Math.hypot(rays[0].x, rays[0].y))
  })
})

describe('same-table extent and dot patch', () => {
  const center = { x: 0, y: 0.75, z: -1, up: 1 }

  it('counts only hits at the table height that face up', () => {
    const samples = [
      { x: 0.05, y: 0.752, z: -1, up: 1 }, // same table, 5 cm away
      { x: 0, y: 0.75, z: -1.12, up: 0.95 }, // same table, 12 cm away
      { x: 0.3, y: 0.4, z: -1, up: 1 }, // the floor, lower
      { x: -0.2, y: 0.75, z: -1, up: 0.2 }, // a wall
      null,
    ]
    expect(sameTableExtent(center, samples)).toBeCloseTo(0.12)
  })

  it('is zero when only the centre counts, and keeps the patch within bounds', () => {
    expect(sameTableExtent(center, [])).toBe(0)
    expect(patchRadius(0)).toBe(PATCH_MIN_RADIUS)
    expect(patchRadius(0.04)).toBeCloseTo(0.06)
    expect(patchRadius(1)).toBe(PATCH_MAX_RADIUS)
    expect(patchRadius(Number.NaN)).toBe(PATCH_MIN_RADIUS)
  })
})

describe('surface tracker (no flicker)', () => {
  it('needs a steady run of hits before the table counts as found', () => {
    const tracker = createSurfaceTracker()
    expect(tracker.update(true, 0)).toBe(false)
    expect(tracker.update(true, SURFACE_ACQUIRE_MS - 1)).toBe(false)
    expect(tracker.update(true, SURFACE_ACQUIRE_MS)).toBe(true)
  })

  it('restarts acquiring after a miss', () => {
    const tracker = createSurfaceTracker()
    tracker.update(true, 0)
    tracker.update(false, 100)
    expect(tracker.update(true, 250)).toBe(false)
    expect(tracker.update(true, 250 + SURFACE_ACQUIRE_MS)).toBe(true)
  })

  it('keeps a found table through short misses and drops it after a long run', () => {
    const tracker = createSurfaceTracker()
    tracker.update(true, 0)
    tracker.update(true, SURFACE_ACQUIRE_MS)
    expect(tracker.update(false, SURFACE_ACQUIRE_MS + 100)).toBe(true)
    expect(tracker.update(true, SURFACE_ACQUIRE_MS + 150)).toBe(true)
    expect(tracker.update(false, SURFACE_ACQUIRE_MS + 150 + SURFACE_RELEASE_MS - 1)).toBe(true)
    expect(tracker.update(false, SURFACE_ACQUIRE_MS + 150 + SURFACE_RELEASE_MS)).toBe(false)
  })

  it('starts over after reset', () => {
    const tracker = createSurfaceTracker()
    tracker.update(true, 0)
    tracker.update(true, SURFACE_ACQUIRE_MS)
    tracker.reset()
    expect(tracker.update(true, 1000)).toBe(false)
  })
})

describe('smoothing', () => {
  it('glides part of the way, and jumps to a far new table', () => {
    expect(smoothToward(null, { x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 })
    const near = smoothToward({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, 0.5)
    expect(near.x).toBeCloseTo(0.05)
    expect(smoothToward({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 })
  })
})

describe('scanning hints and tracking', () => {
  it('waits before the first tip, then rotates through the tips', () => {
    expect(scanningHintIndex(0, 3)).toBeNull()
    expect(scanningHintIndex(SCANNING_HINT_DELAY_MS - 1, 3)).toBeNull()
    expect(scanningHintIndex(SCANNING_HINT_DELAY_MS, 3)).toBe(0)
    expect(scanningHintIndex(SCANNING_HINT_DELAY_MS + SCANNING_HINT_EVERY_MS, 3)).toBe(1)
    expect(scanningHintIndex(SCANNING_HINT_DELAY_MS + 3 * SCANNING_HINT_EVERY_MS, 3)).toBe(0)
    expect(scanningHintIndex(60_000, 0)).toBeNull()
  })

  it('calls a placed dish lost only after its anchor is unseen for a moment', () => {
    expect(isTrackingLost(null, 5000)).toBe(false)
    expect(isTrackingLost(1000, 1500)).toBe(false)
    expect(isTrackingLost(1000, 2000)).toBe(true)
  })
})
