import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import type { PublicProductArModel } from '@/types/database'

export interface MenuLike { id: string; slug?: string | null; is_default?: boolean | null }
function single<T>(rows: readonly T[], predicate: (row: T) => boolean): T | null {
  const matches = rows.filter(predicate)
  return matches.length === 1 ? matches[0] : null
}
export function pickDefaultMenu<M extends MenuLike>(menus: readonly M[]): M | null {
  return single(menus, menu => menu.is_default === true) ?? menus[0] ?? null
}
export function pickSectionMenu<M extends MenuLike>(menus: readonly M[], slug: string, location: { menu_id?: string | null } | null): M | null {
  if (location) return (location.menu_id ? menus.find(menu => menu.id === location.menu_id) : null) ?? pickDefaultMenu(menus)
  return single(menus, menu => menu.slug === slug)
}
export function groupByProductId<T extends { product_id: string }>(rows: readonly T[] | null | undefined): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const row of rows ?? []) (result[row.product_id] ??= []).push(row)
  return result
}
/**
 * 3D models by product (one per dish), keeping only rows with a model URL.
 * Before the product_ar_models table exists the loaders pass null: the menu
 * then simply has no 3D views.
 */
export function arModelsByProductId(rows: readonly PublicProductArModel[] | null | undefined): Record<string, PublicProductArModel> {
  const result: Record<string, PublicProductArModel> = {}
  for (const row of rows ?? []) {
    if (!row.glb_url) continue
    // Only what guests need: the legacy loader reads '*' (storage keys, sizes).
    const scale = Number(row.scale)
    result[row.product_id] = {
      product_id: row.product_id,
      glb_url: row.glb_url,
      usdz_url: row.usdz_url ?? null,
      poster_url: row.poster_url ?? null,
      real_scale: row.real_scale !== false,
      ...(Number.isFinite(scale) && scale > 0 && row.scale != null ? { scale } : {}),
    }
  }
  return result
}
export function buildOptionGroupsByProductId(groups: readonly GroupWithOptions[] | null | undefined): Record<string, GroupWithOptions[]> {
  return groupByProductId((groups ?? []).map(group => ({ ...group, options: (group.options ?? []).filter(option => option.is_available) })))
}
