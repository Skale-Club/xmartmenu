/**
 * Gesture zoning (docs/product/ar-experience-plan.md §6): measures the AR
 * overlay's regions from the elements marked `data-ar-region` in
 * WebXrDishViewer, for src/lib/ar/gesture-router.ts. Called when a touch starts,
 * so the bands follow the real layout (safe areas, long names, the dock only
 * once the dish is placed).
 */
import type { ArZones } from '@/lib/ar/gesture-router'

/** Extra margin below the name strip, so a drag just under the name is not taken for the scene. */
const NAME_MARGIN_PX = 8

export function measureArZones(overlay: HTMLElement | null): ArZones | null {
  if (!overlay) return null
  const box = overlay.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null
  const rectOf = (region: string) => overlay.querySelector(`[data-ar-region="${region}"]`)?.getBoundingClientRect() ?? null
  const top = rectOf('top')
  const name = rectOf('name')
  const dock = rectOf('dock')
  const topBottom = top ? top.bottom - box.top : 0
  const nameBottom = Math.max(topBottom, name ? name.bottom - box.top + NAME_MARGIN_PX : topBottom)
  const dockTop = dock ? dock.top - box.top : box.height
  return { width: box.width, height: box.height, topBottom, nameBottom, dockTop }
}
