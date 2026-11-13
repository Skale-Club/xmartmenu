/**
 * Augmented reality: the surface finder's decisions, pure and unit-tested
 * (tests/unit/ar/surface-finder.test.ts). Used by src/lib/ar/webxr-dish-session.ts.
 *
 *   rays      a few hit-test rays in a small cone around the screen centre
 *   extent    how far, around the centre hit, the same flat table was hit
 *   stability a table counts as found after a short steady run of hits and
 *             as lost only after a short run of misses (no flicker)
 *   smoothing the dot patch glides towards the newest hit instead of jumping
 *   hints     after a while without a table, one short tip at a time
 *   tracking  a placed dish whose anchor is not seen for a moment = lost
 *
 * Owner rule (docs/product/ar-experience-plan.md): minimal dots only where the
 * real table was hit; never paint a surface that was not detected.
 */

export interface Vec3 { x: number; y: number; z: number }

/** A hit-test result: its position and the vertical component of its normal (1 = flat, facing up). */
export interface SurfaceSample extends Vec3 { up: number }

/** A table counts as found after this long of steady hits under the centre. */
export const SURFACE_ACQUIRE_MS = 200
/** …and as lost only after this long without one. */
export const SURFACE_RELEASE_MS = 400
/** Hits within this height of the centre hit belong to the same table (metres). */
export const SAME_TABLE_HEIGHT = 0.015
/** Normal threshold for "faces up" (≈ 25° from flat). */
export const FACES_UP = 0.9
/** The dot patch's radius bounds (metres). */
export const PATCH_MIN_RADIUS = 0.035
export const PATCH_MAX_RADIUS = 0.08

/**
 * Directions (viewer space, unit length, -Z forward) for the extra rays: `perRing`
 * rays on each ring, `rings` given as angles from the centre in radians.
 */
export function offsetDirections(rings: number[] = [0.05, 0.1], perRing = 6): Vec3[] {
  const directions: Vec3[] = []
  rings.forEach((ring, ringIndex) => {
    for (let i = 0; i < perRing; i++) {
      // Stagger alternate rings so the rays spread evenly.
      const around = ((i + (ringIndex % 2) * 0.5) / perRing) * Math.PI * 2
      const x = Math.sin(ring) * Math.cos(around)
      const y = Math.sin(ring) * Math.sin(around)
      const z = -Math.cos(ring)
      directions.push({ x, y, z })
    }
  })
  return directions
}

/**
 * Horizontal distance from the centre hit to the farthest hit that lies on the
 * same flat table (same height, facing up). 0 when only the centre counts.
 */
export function sameTableExtent(center: SurfaceSample, samples: (SurfaceSample | null | undefined)[], heightTolerance = SAME_TABLE_HEIGHT): number {
  let extent = 0
  for (const sample of samples) {
    if (!sample || sample.up < FACES_UP) continue
    if (Math.abs(sample.y - center.y) > heightTolerance) continue
    extent = Math.max(extent, Math.hypot(sample.x - center.x, sample.z - center.z))
  }
  return extent
}

/** Radius of the dot patch for a detected extent: a little beyond it, within fixed bounds. */
export function patchRadius(extent: number): number {
  if (!Number.isFinite(extent) || extent < 0) return PATCH_MIN_RADIUS
  return Math.min(PATCH_MAX_RADIUS, Math.max(PATCH_MIN_RADIUS, extent + 0.02))
}

/** Hysteresis for "table found": steady hits to acquire, a run of misses to release. */
export function createSurfaceTracker(acquireMs = SURFACE_ACQUIRE_MS, releaseMs = SURFACE_RELEASE_MS) {
  let found = false
  let firstHit: number | null = null
  let lastHit: number | null = null
  return {
    /** Feeds one frame; returns whether a table is (still) considered found. */
    update(hit: boolean, time: number): boolean {
      if (hit) {
        lastHit = time
        if (!found) {
          if (firstHit === null) firstHit = time
          if (time - firstHit >= acquireMs) found = true
        }
      } else if (found) {
        if (lastHit !== null && time - lastHit >= releaseMs) {
          found = false
          firstHit = null
        }
      } else {
        // Acquiring needs an unbroken run of hits.
        firstHit = null
      }
      return found
    },
    reset() {
      found = false
      firstHit = null
      lastHit = null
    },
  }
}

/** Moves `current` part of the way to `target`; jumps when the gap is large (a new table). */
export function smoothToward(current: Vec3 | null, target: Vec3, alpha = 0.35, snapDistance = 0.3): Vec3 {
  if (!current) return { ...target }
  const gap = Math.hypot(target.x - current.x, target.y - current.y, target.z - current.z)
  if (gap > snapDistance) return { ...target }
  return {
    x: current.x + (target.x - current.x) * alpha,
    y: current.y + (target.y - current.y) * alpha,
    z: current.z + (target.z - current.z) * alpha,
  }
}

/** First tip after this long scanning; then the next tip every SCANNING_HINT_EVERY_MS. */
export const SCANNING_HINT_DELAY_MS = 8000
export const SCANNING_HINT_EVERY_MS = 4000

/** Which tip (0-based) to show after `elapsedMs` of scanning, or null for none yet. */
export function scanningHintIndex(elapsedMs: number, count: number): number | null {
  if (count <= 0 || !Number.isFinite(elapsedMs) || elapsedMs < SCANNING_HINT_DELAY_MS) return null
  return Math.floor((elapsedMs - SCANNING_HINT_DELAY_MS) / SCANNING_HINT_EVERY_MS) % count
}

/** A placed dish counts as lost when its anchor has not been seen for this long. */
export const TRACKING_GRACE_MS = 1000

export function isTrackingLost(lastSeen: number | null, now: number, graceMs = TRACKING_GRACE_MS): boolean {
  return lastSeen !== null && now - lastSeen >= graceMs
}
