/**
 * Data loader for the public menu pages: /[slug] and /[slug]/[menuSlug].
 *
 * Every Supabase call is a network round trip (150–300 ms from the app server),
 * so the queries are grouped by what they depend on and each group runs in
 * parallel. Four sequential stages instead of one await per query:
 *
 *   1. slug          → tenant (+ settings), platform footer brand
 *   2. tenant.id     → active menus, locations, plan capabilities, chat addon
 *                      status + channels, the ?table= row, delivery zones
 *   3. menu.id       → categories, products (+ private-menu session check)
 *   4. product ids   → option groups, product ingredients, product media
 *
 * The menu is picked in memory from the tenant's active menus (one query),
 * with the same rules the pages used to apply with one query per candidate.
 *
 * Everything that does not depend on the visitor is cached for a short while
 * per restaurant and section (src/lib/menu/public-menu-cache.ts); the
 * ?table= row is picked from the cached table list, and a private menu's
 * phone-session check runs on every request.
 */
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { getChatAddonStatus } from '@/lib/chat-addon'
import { hasAnyChannel, resolveChatChannels } from '@/lib/chat-channels'
import type { TenantCapabilities } from '@/lib/service-modes'
import type { DeliveryZone, ProductIngredientWithIngredient, ProductMedia } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { menuCacheKey, menuCacheTags, publicMenuCacheSeconds } from '@/lib/menu/public-menu-cache'

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/unit/menu/public-menu-data.test.ts)
// ---------------------------------------------------------------------------

export interface MenuLike {
  id: string
  slug?: string | null
  is_default?: boolean | null
}

/** The single row matching `predicate`; null when none or several (same as PostgREST maybeSingle()). */
function single<T>(rows: readonly T[], predicate: (row: T) => boolean): T | null {
  const matches = rows.filter(predicate)
  return matches.length === 1 ? matches[0] : null
}

/**
 * The tenant's default menu: the one active menu flagged is_default, otherwise
 * the first active menu by position. `activeMenus` must be the tenant's active
 * menus ordered by position.
 */
export function pickDefaultMenu<M extends MenuLike>(activeMenus: readonly M[]): M | null {
  return single(activeMenus, m => m.is_default === true) ?? activeMenus[0] ?? null
}

/**
 * The menu for /[slug]/[section]: when `location` is set (the segment is a
 * branch slug) its own menu if active, else the default menu; otherwise the
 * active menu whose slug is the segment. `activeMenus` must be ordered by position.
 */
export function pickSectionMenu<M extends MenuLike>(
  activeMenus: readonly M[],
  sectionSlug: string,
  location: { menu_id?: string | null } | null,
): M | null {
  if (location) {
    const own = location.menu_id ? activeMenus.find(m => m.id === location.menu_id) ?? null : null
    return own ?? pickDefaultMenu(activeMenus)
  }
  return single(activeMenus, m => m.slug === sectionSlug)
}

/** Rows bucketed by product_id, keeping their order. */
export function groupByProductId<T extends { product_id: string }>(rows: readonly T[] | null | undefined): Record<string, T[]> {
  const byProduct: Record<string, T[]> = {}
  for (const row of rows ?? []) {
    ;(byProduct[row.product_id] ??= []).push(row)
  }
  return byProduct
}

/** Option groups by product, each keeping only its available options. */
export function buildOptionGroupsByProductId(rawGroups: readonly GroupWithOptions[] | null | undefined): Record<string, GroupWithOptions[]> {
  return groupByProductId(
    (rawGroups ?? []).map(group => ({
      ...group,
      options: (group.options ?? []).filter(o => o.is_available),
    })),
  )
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Columns the branch picker shows. */
const BRANCH_COLUMNS = 'id, name, slug, address, city, phone, business_hours'

export interface LoadPublicMenuOptions {
  slug: string
  /**
   * Second path segment (/[slug]/[menuSlug]): a branch slug or a menu slug.
   * Omitted on the tenant root, which shows the branch picker for 2+ branches.
   */
  menuSlug?: string
  /** Parsed ?table= id (parseTableParam), or null. */
  tableId: string | null
  /**
   * Private menus only: whether the caller may see it (phone-verified session).
   * Runs on every request, outside the cache; when it says no, the menu's
   * options, ingredients and media are left out of the result.
   */
  checkPrivateAccess?: () => Promise<boolean>
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come from an untyped service client, as in the pages */
export interface PublicMenuData {
  tenant: any
  footerBrand: string
  menu: any | null
  /** The branch, when the section slug is a branch slug. */
  location: any | null
  categories: any[]
  products: any[]
  capabilities: TenantCapabilities
  optionGroupsByProductId: Record<string, GroupWithOptions[]>
  productIngredientsByProductId: Record<string, ProductIngredientWithIngredient[]>
  productMediaByProductId: Record<string, ProductMedia[]>
  deliveryZones: DeliveryZone[]
  chatAddonEnabled: boolean
  chatAddonAudioEnabled: boolean
  chatAddonTextEnabled: boolean
  /** The ?table= row when guests can order to it or call a waiter from it. */
  table: { id: string; name: string } | null
  /** menu.is_private and checkPrivateAccess() said yes. */
  privateAccess: boolean
}

export type PublicMenuResult =
  | { kind: 'not_found' }
  | { kind: 'branches'; tenant: any; footerBrand: string; locations: any[] }
  | ({ kind: 'menu' } & PublicMenuData)

/** What the cache holds: the visitor-independent part of PublicMenuResult, plus the tables to pick from. */
export type CachedPublicMenu =
  | { kind: 'not_found' }
  | { kind: 'branches'; tenant: any; footerBrand: string; locations: any[] }
  | ({ kind: 'menu' } & Omit<PublicMenuData, 'table' | 'privateAccess'> & { tables: Array<{ id: string; name: string }> })

/**
 * The four query stages, with nothing visitor-specific: safe to cache per
 * (slug, menuSlug). Reads with the service client it creates itself (a cache
 * key must be serialisable, so no client is passed in).
 */
export async function loadPublicMenuBase(slug: string, menuSlug: string | undefined): Promise<CachedPublicMenu> {
  const supabase = createServiceClient()

  // Stage 1 — needs the slug.
  const [{ data: tenant }, { data: platformRow }] = await Promise.all([
    supabase.from('tenants').select('*, tenant_settings(*)').eq('slug', slug).eq('is_active', true).single(),
    supabase.from('platform_settings').select('menu_footer_brand').single(),
  ])
  if (!tenant) return { kind: 'not_found' }
  const footerBrand: string = platformRow?.menu_footer_brand ?? 'XmartMenu'
  const settings = tenant.tenant_settings as any

  // Stage 2 — needs tenant.id.
  const [
    { data: activeMenus },
    { data: locationData },
    capabilities,
    chatStatus,
    { data: chatSettings },
    { data: tableRows },
    { data: zones },
  ] = await Promise.all([
    supabase.from('menus').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('position'),
    menuSlug === undefined
      // LOC-03: 2+ active branches → branch picker
      ? supabase.from('locations').select(BRANCH_COLUMNS).eq('tenant_id', tenant.id).eq('is_active', true).order('created_at', { ascending: true })
      // LOC-03: the segment may be a branch slug
      : supabase.from('locations').select('*').eq('tenant_id', tenant.id).eq('slug', menuSlug).eq('is_active', true).maybeSingle(),
    // What the plan and the restaurant allow (service-modes.ts), computed once.
    getTenantCapabilities(tenant.id, settings, supabase),
    // SEED-024: chat addon status for the widget
    getChatAddonStatus(tenant.id),
    // One tiny row; fetched up front and dropped below when the addon is off.
    supabase.from('chat_addon_settings').select('audio_enabled, text_enabled').eq('tenant_id', tenant.id).maybeSingle(),
    // Every active table: the ?table= of a link is picked from this list per request.
    supabase.from('restaurant_tables').select('id, name').eq('tenant_id', tenant.id).eq('is_active', true),
    // Delivery zones for zone-based checkout pricing; kept below only when guests can order delivery.
    settings?.delivery_enabled === true
      ? supabase.from('delivery_zones').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('created_at')
      : Promise.resolve({ data: [] }),
  ])

  const menus: any[] = activeMenus ?? []
  let location: any | null = null
  let menu: any | null
  if (menuSlug === undefined) {
    const branches: any[] = (locationData as any[] | null) ?? []
    if (branches.length >= 2) return { kind: 'branches', tenant, footerBrand, locations: branches }
    menu = pickDefaultMenu(menus)
  } else {
    location = locationData ?? null
    menu = pickSectionMenu(menus, menuSlug, location)
    if (!location && !menu) return { kind: 'not_found' }
  }

  // Typed messages and voice notes are switched per restaurant; none = no chat box.
  const chatChannels = resolveChatChannels(chatStatus.enabled ? chatSettings : null)
  const deliveryZones = (capabilities.delivery ? zones ?? [] : []) as DeliveryZone[]
  const tables = (tableRows ?? []) as Array<{ id: string; name: string }>

  // Stage 3 — needs menu.id.
  const [{ data: categoryRows }, { data: productRows }] = await Promise.all([
    menu?.id
      ? supabase.from('categories').select('*').eq('menu_id', menu.id).eq('is_active', true).order('position')
      : Promise.resolve({ data: [] }),
    menu?.id
      ? supabase.from('products').select('*').eq('menu_id', menu.id).eq('is_available', true).order('position')
      : Promise.resolve({ data: [] }),
  ])
  const categories: any[] = categoryRows ?? []
  const products: any[] = productRows ?? []
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Stage 4 — needs the product ids. Option groups (sizes, flavours…) are part
  // of the dish: shown even on a browse-only menu. Ingredient add/remove only
  // exists while ordering. For a private menu they are loaded here and dropped
  // per request for a caller who may not see it (withoutDetails).
  const productIds = products.map(p => p.id)
  const loadDetails = productIds.length > 0
  const [{ data: rawGroups }, { data: rawIngredients }, { data: rawMedia }] = await Promise.all([
    loadDetails
      ? supabase
          .from('product_option_groups')
          .select('*, options:product_options(*)')
          .in('product_id', productIds)
          .order('position')
          .order('position', { referencedTable: 'product_options' })
      : Promise.resolve({ data: [] }),
    loadDetails && capabilities.ingredientCustomization
      ? supabase.from('product_ingredients').select('*, ingredient:ingredients(*)').in('product_id', productIds).order('position')
      : Promise.resolve({ data: [] }),
    // SEED-021: product media for all products on this menu
    loadDetails
      ? supabase.from('product_media').select('*').in('product_id', productIds).order('display_order')
      : Promise.resolve({ data: [] }),
  ])

  return {
    kind: 'menu',
    tenant,
    footerBrand,
    menu: menu ?? null,
    location,
    categories,
    products,
    capabilities,
    optionGroupsByProductId: buildOptionGroupsByProductId(rawGroups as GroupWithOptions[] | null),
    productIngredientsByProductId: groupByProductId(rawIngredients as ProductIngredientWithIngredient[] | null),
    productMediaByProductId: groupByProductId(rawMedia as ProductMedia[] | null),
    deliveryZones,
    chatAddonEnabled: chatStatus.enabled && hasAnyChannel(chatChannels),
    chatAddonAudioEnabled: chatChannels.voice,
    chatAddonTextEnabled: chatChannels.text,
    tables,
  }
}

/**
 * The cached base for a (slug, menuSlug): one entry per restaurant and
 * section, tagged for revalidation (public-menu-cache.ts), deduplicated per
 * request so generateMetadata and the page share one read.
 */
export const getPublicMenuBase = cache(async (slug: string, menuSlug: string | undefined): Promise<CachedPublicMenu> => {
  const seconds = publicMenuCacheSeconds()
  if (seconds <= 0) return loadPublicMenuBase(slug, menuSlug)
  const cached = unstable_cache(
    () => loadPublicMenuBase(slug, menuSlug),
    menuCacheKey(slug, menuSlug),
    { revalidate: seconds, tags: menuCacheTags(slug) },
  )
  return cached()
})

/** The active tenant (+ settings) for a slug, from the cached base. */
export async function getTenantBySlug(slug: string) {
  const base = await getPublicMenuBase(slug, undefined)
  return base.kind === 'not_found' ? null : base.tenant
}

// ---------------------------------------------------------------------------
// Per-request part (pure helpers, unit-tested)
// ---------------------------------------------------------------------------

/** The ?table= row of a link, when the restaurant serves at the table (orders or waiter calls). */
export function pickTable(
  tables: readonly { id: string; name: string }[],
  tableId: string | null,
  capabilities: Pick<TenantCapabilities, 'guestOrdering' | 'waiterCalls'>,
): { id: string; name: string } | null {
  if (!tableId || !(capabilities.guestOrdering || capabilities.waiterCalls)) return null
  return tables.find(t => t.id === tableId) ?? null
}

/** A private menu for a caller who may not see it: the dishes without their options, ingredients and media. */
export function withoutDetails<T extends Pick<PublicMenuData, 'optionGroupsByProductId' | 'productIngredientsByProductId' | 'productMediaByProductId'>>(data: T): T {
  return { ...data, optionGroupsByProductId: {}, productIngredientsByProductId: {}, productMediaByProductId: {} }
}

export async function loadPublicMenuData({
  slug,
  menuSlug,
  tableId,
  checkPrivateAccess,
}: LoadPublicMenuOptions): Promise<PublicMenuResult> {
  const base = await getPublicMenuBase(slug, menuSlug)
  if (base.kind !== 'menu') return base

  const { tables, ...data } = base
  const isPrivate = data.menu?.is_private === true
  const privateAccess = isPrivate && checkPrivateAccess ? await checkPrivateAccess() : false
  const visible = isPrivate && !privateAccess ? withoutDetails(data) : data
  return {
    ...visible,
    table: pickTable(tables, tableId, data.capabilities),
    privateAccess,
  }
}
