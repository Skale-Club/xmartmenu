/**
 * Augmented reality: walking through the menu's 3D dishes without leaving the
 * camera (docs/product/ar-experience-plan.md §4). Pure; tested in
 * tests/unit/ar/dish-sequence.test.ts.
 *
 *   step       previous / next dish in menu order (no wrap-around)
 *   neighbours the dishes to preload while one is on screen
 *   progress   a download's percentage, or null when the size is unknown
 */

/** The dish `direction` away from `id`, or null at either end. */
export function stepDish<T extends { id: string }>(items: T[], id: string, direction: 'next' | 'prev'): T | null {
  const index = items.findIndex(item => item.id === id)
  if (index < 0) return null
  const target = direction === 'next' ? index + 1 : index - 1
  return items[target] ?? null
}

/** The previous and next dishes, to download in the background. */
export function neighbours<T extends { id: string }>(items: T[], id: string): T[] {
  return [stepDish(items, id, 'prev'), stepDish(items, id, 'next')].filter((item): item is T => item !== null)
}

/** Download percentage 0–100, or null when the server did not say how big the file is. */
export function progressPercent(loaded: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(loaded)) return null
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
}

/** Whether to preload neighbours: not when the guest asked the browser to save data. */
export function mayPreload(connection: { saveData?: boolean } | undefined | null): boolean {
  return connection?.saveData !== true
}
