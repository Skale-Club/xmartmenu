import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'

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
export function buildOptionGroupsByProductId(groups: readonly GroupWithOptions[] | null | undefined): Record<string, GroupWithOptions[]> {
  return groupByProductId((groups ?? []).map(group => ({ ...group, options: (group.options ?? []).filter(option => option.is_available) })))
}
