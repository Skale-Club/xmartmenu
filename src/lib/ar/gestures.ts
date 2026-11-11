/**
 * Augmented reality: the math behind the dish gestures in the WebXR viewer
 * (src/lib/ar/webxr-dish-session.ts). Pure, unit-tested in
 * tests/unit/ar/gestures.test.ts.
 *
 *   pinch   two fingers apart/together → resize, 50 %–300 %, snapping to
 *           100 % (real size) when close to it
 *   twist   two fingers turning → turn the dish around its vertical axis
 *   drag    one finger → move the dish along the table (hit test, not here)
 */

export const MIN_DISH_SCALE = 0.5
export const MAX_DISH_SCALE = 3
/** Within this distance of 100 % the dish snaps back to its real size. */
export const REAL_SIZE_SNAP = 0.05

export interface Point { x: number; y: number }

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Angle of the line from a to b, in radians. */
export function angle(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

/** Clamps to 50 %–300 % and snaps to exactly 1 near the real size. */
export function clampDishScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  const clamped = Math.min(MAX_DISH_SCALE, Math.max(MIN_DISH_SCALE, scale))
  return Math.abs(clamped - 1) <= REAL_SIZE_SNAP ? 1 : clamped
}

/**
 * The dish scale for a pinch: the scale when the two fingers went down,
 * times how much farther apart they are now.
 */
export function pinchScale(startScale: number, startDistance: number, currentDistance: number): number {
  if (startDistance <= 0) return clampDishScale(startScale)
  return clampDishScale(startScale * (currentDistance / startDistance))
}

/** Smallest signed difference between two angles, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let delta = to - from
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta <= -Math.PI) delta += 2 * Math.PI
  return delta
}

/**
 * The dish's turn (yaw) for a twist. Turning the fingers clockwise on the
 * screen turns the dish clockwise seen from above, which is a negative yaw.
 */
export function twistYaw(startYaw: number, startAngle: number, currentAngle: number): number {
  return startYaw - angleDelta(startAngle, currentAngle)
}

/** "100 %" style label for the size chip, rounded to 5 %. */
export function scalePercent(scale: number): number {
  return Math.round((scale * 100) / 5) * 5
}

/**
 * Whether a surface hit is a table or floor, not a wall or a slope: the
 * surface normal (its local +Y) must point up. `upComponent` is the normal's
 * vertical component (1 = flat, facing up).
 */
export function isHorizontalSurface(upComponent: number, threshold = 0.9): boolean {
  return upComponent >= threshold
}
