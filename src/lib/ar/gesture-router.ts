/**
 * Augmented reality: who owns a touch (docs/product/ar-experience-plan.md §6,
 * "one region, one job"). Pure and unit-tested in tests/unit/ar/gesture-router.test.ts;
 * the WebXR session (src/lib/ar/webxr-dish-session.ts) only acts on its answers.
 *
 *   top / dock   buttons only: the scene never gets these touches
 *   edge         left to the phone (back / home gestures)
 *   name         the dish name strip: swipe = change dish, tap = details (UI)
 *   scene        before placing: tap = place · after: drag ON the dish = move,
 *                two fingers = rotate (after a small angle), never resize
 *
 * The region where the first finger lands owns the whole gesture until every
 * finger lifts. Sheets cover the scene with their own scrim, so they need no
 * rule here.
 */

export type ArRegion = 'top' | 'name' | 'dock' | 'edge' | 'scene'

export interface Point { x: number; y: number }

/** Screen bands measured from the overlay (px). `nameBottom` ≥ `topBottom`. */
export interface ArZones {
  width: number
  height: number
  /** Bottom edge of the top bar. */
  topBottom: number
  /** Bottom edge of the name strip (and its indicator). */
  nameBottom: number
  /** Top edge of the bottom dock. */
  dockTop: number
}

/** Side strips left to the phone's own back gesture. */
export const EDGE_PX = 24
/** A tap moves less than this… */
export const TAP_MOVE_PX = 10
/** …and lasts less than this. */
export const TAP_MS = 300
/** A drag that starts this close to the dish's outline still grabs it. */
export const DISH_GRAB_TOLERANCE_PX = 48
/** Two fingers must turn this much before the dish rotates (no jitter). */
export const TWIST_START_RAD = (4 * Math.PI) / 180
/** After placing or changing dish, scene taps and drags wait this long. */
export const SCENE_COOLDOWN_MS = 300
/** A dish swipe on the name strip: at least this far sideways… */
export const SWIPE_MIN_PX = 48
/** …and clearly more sideways than vertical. */
export const SWIPE_RATIO = 1.5

/** Which region a point belongs to. */
export function regionAt(point: Point, zones: ArZones): ArRegion {
  if (point.x < EDGE_PX || point.x > zones.width - EDGE_PX) return 'edge'
  if (point.y < zones.topBottom) return 'top'
  if (point.y < zones.nameBottom) return 'name'
  if (point.y >= zones.dockTop) return 'dock'
  return 'scene'
}

/** Whether a finished touch counts as a tap. */
export function isTap(moved: number, ms: number): boolean {
  return moved < TAP_MOVE_PX && ms < TAP_MS
}

/** The dish's outline on screen: centre and radius (px). */
export interface DishOnScreen { x: number; y: number; radius: number }

/** Whether a one-finger drag starting at `point` grabs the dish. */
export function grabsDish(point: Point, dish: DishOnScreen | null): boolean {
  if (!dish) return false
  return Math.hypot(point.x - dish.x, point.y - dish.y) <= dish.radius + DISH_GRAB_TOLERANCE_PX
}

export type SceneStart = 'none' | 'tap-candidate' | 'drag-dish' | 'twist'

/**
 * What a touch that starts in the scene may become.
 * `fingers` is how many touch the screen now; `sinceSettled` is the time since
 * the last placement or dish change.
 */
export function sceneStart(opts: { stage: 'scanning' | 'surface' | 'placed'; fingers: number; onDish: boolean; sinceSettled: number; cooldownMs?: number }): SceneStart {
  const { stage, fingers, onDish, sinceSettled, cooldownMs = SCENE_COOLDOWN_MS } = opts
  if (sinceSettled < cooldownMs) return 'none'
  if (stage !== 'placed') return fingers === 1 ? 'tap-candidate' : 'none'
  if (fingers >= 2) return 'twist'
  return onDish ? 'drag-dish' : 'none'
}

/** Rotation is applied only once the fingers have turned past the start angle. */
export function twistActive(delta: number): boolean {
  return Math.abs(delta) >= TWIST_START_RAD
}

/** A swipe on the name strip: 'next' (to the left), 'prev' (to the right) or null. */
export function dishSwipe(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return null
  return dx < 0 ? 'next' : 'prev'
}
