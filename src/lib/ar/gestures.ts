/**
 * Augmented reality: the math behind the dish gestures in the WebXR viewer
 * (src/lib/ar/webxr-dish-session.ts). Pure, unit-tested in
 * tests/unit/ar/gestures.test.ts.
 *
 *   twist   two fingers turning → turn the dish around its vertical axis
 *   drag    one finger → move the dish along the table (hit test, not here)
 *
 * There is no pinch-to-resize: the dish always shows at its real size, which
 * is the point of seeing it on the table (docs/product/ar-experience-plan.md).
 * To see detail, the guest moves the phone closer.
 */

export interface Point { x: number; y: number }

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Angle of the line from a to b, in radians. */
export function angle(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
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

/**
 * Whether a surface hit is a table or floor, not a wall or a slope: the
 * surface normal (its local +Y) must point up. `upComponent` is the normal's
 * vertical component (1 = flat, facing up).
 */
export function isHorizontalSurface(upComponent: number, threshold = 0.9): boolean {
  return upComponent >= threshold
}
