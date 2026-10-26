/**
 * Cache of the public menu data (src/lib/menu/public-menu-data.ts).
 *
 * Every Supabase round trip costs ~150–450 ms from the app server, and the
 * public menu needs four of them per visit, so the loaded data is kept in the
 * Next.js data cache for a short while, per restaurant (slug) and section
 * (menu or branch slug). Anything that depends on the visitor — the ?table=
 * the link belongs to, the phone session that unlocks a private menu, the
 * language and view — is resolved outside the cache on every request.
 *
 * Tags: `menu:slug:<slug>` (one restaurant) and `menu:platform` (every
 * restaurant: platform settings, plan features). Writers call
 * revalidatePublicMenu() / revalidateAllPublicMenus(); the TTL is the safety
 * net for anything that writes without telling us.
 *
 * `PUBLIC_MENU_CACHE_SECONDS` sets the TTL (default 60); 0 disables the cache.
 */
import { revalidateTag } from 'next/cache'

export const PLATFORM_MENU_TAG = 'menu:platform'
export const DEFAULT_PUBLIC_MENU_CACHE_SECONDS = 60

/** The tag for one restaurant's public menu. */
export function menuSlugTag(slug: string): string {
  return `menu:slug:${slug.toLowerCase()}`
}

/** Tags carried by every cached entry of a restaurant. */
export function menuCacheTags(slug: string): string[] {
  return [menuSlugTag(slug), PLATFORM_MENU_TAG]
}

/** Cache key parts for a restaurant + section; the same input always hits the same entry. */
export function menuCacheKey(slug: string, menuSlug: string | undefined): string[] {
  return ['public-menu', 'v1', slug.toLowerCase(), menuSlug?.toLowerCase() ?? '']
}

/** TTL in seconds from the environment; 0 means "do not cache". */
export function publicMenuCacheSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PUBLIC_MENU_CACHE_SECONDS
  if (raw === undefined || raw === '') return DEFAULT_PUBLIC_MENU_CACHE_SECONDS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_PUBLIC_MENU_CACHE_SECONDS
}

/** Drop the cached menu of one restaurant (after anything that changes what guests see). */
export function revalidatePublicMenu(slug: string | null | undefined): void {
  if (!slug) return
  try {
    revalidateTag(menuSlugTag(slug), 'max')
  } catch {
    // Outside a request scope (scripts, tests) there is no cache to drop.
  }
}

/** Drop every restaurant's cached menu (platform settings, plan features). */
export function revalidateAllPublicMenus(): void {
  try {
    revalidateTag(PLATFORM_MENU_TAG, 'max')
  } catch {
    // Outside a request scope there is no cache to drop.
  }
}
