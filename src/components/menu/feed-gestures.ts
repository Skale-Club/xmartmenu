/**
 * Gestures on a dish in the visual feed (MenuFeed.tsx), the way Instagram
 * splits them: vertical moves between dishes (the scroller does that),
 * horizontal moves between the photos and videos of the SAME dish. The two
 * axes never mean the same thing, so a diagonal drag is settled early on
 * whichever axis it leans to and stays there until the finger lifts.
 *
 * Pure: the component feeds pointer deltas in and gets the decision out.
 */

export type SwipeAxis = 'horizontal' | 'vertical'

/** Movement (px) before a drag is settled on an axis. */
export const AXIS_LOCK_PX = 10
/** Horizontal travel (px) that counts as a swipe when the finger lifts. */
export const SWIPE_PX = 48
/** Or a quick flick: px per ms. */
export const FLICK_VELOCITY = 0.5
/** How far a single-media dish follows the finger before it springs back. */
export const RUBBER_MAX_PX = 56

/** Which axis a drag has committed to, or null while it is still too small to tell. */
export function lockAxis(dx: number, dy: number, current: SwipeAxis | null): SwipeAxis | null {
  if (current) return current
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return null
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
}

/**
 * How far the media follows a horizontal drag. With 2+ slides it tracks the
 * finger (a little damped); with one slide it only stretches a bit and will
 * spring back, so the gesture is felt but goes nowhere.
 */
export function dragOffset(dx: number, slideCount: number): number {
  if (slideCount >= 2) return dx * 0.6
  const stretched = Math.sign(dx) * Math.min(Math.abs(dx) * 0.25, RUBBER_MAX_PX)
  return stretched
}

/** The swipe to apply when the finger lifts: +1 next, -1 previous, 0 none. */
export function resolveSwipe(dx: number, elapsedMs: number, slideCount: number): -1 | 0 | 1 {
  if (slideCount < 2) return 0
  const velocity = elapsedMs > 0 ? Math.abs(dx) / elapsedMs : 0
  if (Math.abs(dx) < SWIPE_PX && velocity < FLICK_VELOCITY) return 0
  if (Math.abs(dx) < AXIS_LOCK_PX) return 0
  return dx < 0 ? 1 : -1
}
