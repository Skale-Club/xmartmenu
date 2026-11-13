/**
 * iOS-style sheets (owner rule, docs/product/design-consistency.md "Sheets"):
 * what a finished drag on a sheet's grabber does. Pure, unit-tested in
 * tests/unit/sheet-gesture.test.ts; used by src/components/sheet/DragSheet.tsx.
 *
 *   drag down far, or fling down        → close
 *   drag down a bit from the large size → back to the normal size
 *   drag up                             → large size
 *   anything smaller                    → stay (snap back)
 */

export type SheetRelease = 'close' | 'collapse' | 'expand' | 'stay'

/** Drag distance (px) that closes a sheet without a fling. */
export const SHEET_CLOSE_DISTANCE = 110
/** A fling: at least this far (px)… */
export const SHEET_FLING_DISTANCE = 40
/** …at this speed (px per ms). */
export const SHEET_FLING_SPEED = 0.6
/** From the large size, this far down returns to the normal size. */
export const SHEET_COLLAPSE_DISTANCE = 60
/** This far up expands to the large size. */
export const SHEET_EXPAND_DISTANCE = 50
/** Up-drags move the sheet only this fraction of the finger (rubber band). */
export const SHEET_RUBBER_BAND = 0.3

/** Decides what a released drag does. `dy` > 0 is downwards; `ms` is the drag's duration. */
export function sheetRelease(dy: number, ms: number, expanded: boolean): SheetRelease {
  const speed = dy / Math.max(1, ms)
  if (dy > SHEET_CLOSE_DISTANCE * (expanded ? 1.5 : 1)) return 'close'
  if (dy > SHEET_FLING_DISTANCE && speed > SHEET_FLING_SPEED) return 'close'
  if (expanded && dy > SHEET_COLLAPSE_DISTANCE) return 'collapse'
  if (!expanded && dy < -SHEET_EXPAND_DISTANCE) return 'expand'
  return 'stay'
}

/** How far the sheet follows the finger: fully downwards, with resistance upwards. */
export function sheetOffset(dy: number): number {
  return dy < 0 ? dy * SHEET_RUBBER_BAND : dy
}

/** The scrim fades as the sheet is dragged down (1 = fully shown). */
export function scrimOpacity(dy: number): number {
  return Math.max(0, 1 - Math.max(0, dy) / 400)
}
