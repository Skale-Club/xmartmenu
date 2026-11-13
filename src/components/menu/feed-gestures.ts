/**
 * Gestures on a dish in the visual feed (MenuFeed.tsx), the way Instagram
 * splits them: vertical moves between dishes (the scroller does that),
 * horizontal moves between the photos and videos of the SAME dish. The two
 * axes never mean the same thing, so a diagonal drag is settled early on
 * whichever axis it leans to and stays there until the finger lifts.
 *
 * Also the endless loop of dishes: the feed renders the dish list three times
 * and, once a scroll settles in the first or last copy, jumps by one copy to
 * the identical card in the middle one (no visible change), so it never ends.
 *
 * Pure: the component feeds pointer deltas and scroll positions in and gets
 * the decision out. Tested in tests/unit/menu/feed-gestures.test.ts.
 */

export type SwipeAxis = 'horizontal' | 'vertical'

/** Movement (px) before a drag is settled on an axis. */
export const AXIS_LOCK_PX = 10
/** Horizontal travel (px) that counts as a swipe when the finger lifts. */
export const SWIPE_PX = 48
/** Or a quick flick: px per ms. */
export const FLICK_VELOCITY = 0.5
/** How far the media stretches past the first / last photo before it springs back. */
export const RUBBER_MAX_PX = 56

/** Which axis a drag has committed to, or null while it is still too small to tell. */
export function lockAxis(dx: number, dy: number, current: SwipeAxis | null): SwipeAxis | null {
  if (current) return current
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return null
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
}

function rubber(dx: number): number {
  return Math.sign(dx) * Math.min(Math.abs(dx) * 0.25, RUBBER_MAX_PX)
}

/**
 * How far the photo track follows a horizontal drag: 1:1 between photos (the
 * neighbour slides in with the finger), a short stretch past the first or the
 * last photo, or on a dish with a single photo, so the gesture is felt but
 * goes nowhere.
 */
export function dragOffset(dx: number, slideCount: number, index = 0): number {
  if (slideCount < 2) return rubber(dx)
  const pastStart = index <= 0 && dx > 0
  const pastEnd = index >= slideCount - 1 && dx < 0
  return pastStart || pastEnd ? rubber(dx) : dx
}

/** The swipe to apply when the finger lifts: +1 next, -1 previous, 0 none (also at either end). */
export function resolveSwipe(dx: number, elapsedMs: number, slideCount: number, index = 0): -1 | 0 | 1 {
  if (slideCount < 2) return 0
  const velocity = elapsedMs > 0 ? Math.abs(dx) / elapsedMs : 0
  if (Math.abs(dx) < SWIPE_PX && velocity < FLICK_VELOCITY) return 0
  if (Math.abs(dx) < AXIS_LOCK_PX) return 0
  const direction = dx < 0 ? 1 : -1
  const target = index + direction
  return target < 0 || target >= slideCount ? 0 : direction
}

/** How many times the dish list is rendered to scroll without end. */
export const LOOP_COPIES = 3

/** Whether the feed loops at all: one dish has nothing to loop through. */
export function loops(count: number): boolean {
  return count >= 2
}

/** The dish (0…count-1) shown at a rendered position. */
export function dishAt(position: number, count: number): number {
  if (count <= 0) return 0
  return ((position % count) + count) % count
}

/** Where the feed starts: the wanted dish in the middle copy (or as is without a loop). */
export function startPosition(dish: number, count: number): number {
  if (count <= 0) return 0
  const clamped = Math.max(0, Math.min(count - 1, dish))
  return loops(count) ? count + clamped : clamped
}

/**
 * After a scroll settles: the same dish in the middle copy when it rests in
 * the first or the last copy (the jump is invisible), otherwise unchanged.
 */
export function recenter(position: number, count: number): number {
  if (!loops(count)) return position
  if (position < count || position >= 2 * count) return count + dishAt(position, count)
  return position
}
