/**
 * Which cached public menus a successful API mutation makes stale
 * (src/lib/menu/public-menu-cache.ts). Decided from the route alone, so
 * every admin, superadmin, billing and webhook route gets it for free from
 * withApi (src/lib/observability/with-api.ts) instead of each handler
 * remembering to call revalidate.
 *
 *   /api/admin/*, /api/tenant/*      → the signed-in restaurant (request context slug)
 *   /api/superadmin/tenants/<id>/*   → that restaurant (slug looked up by id)
 *   /api/superadmin/settings|plans   → every restaurant (footer brand, plan features)
 *   /api/stripe/webhooks             → every restaurant (plan/status changes)
 *
 * Reads (GET/HEAD/OPTIONS) and failed requests never invalidate.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { revalidateAllPublicMenus, revalidatePublicMenu } from './public-menu-cache'

export type MenuCacheAction =
  | { kind: 'all' }
  | { kind: 'current' }
  | { kind: 'tenant'; tenantId: string }

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Pure: what to drop after a `method` request to `pathname` succeeded, or null. */
export function menuCacheActionFor(method: string, pathname: string): MenuCacheAction | null {
  if (!MUTATING.has(method.toUpperCase())) return null
  const path = pathname.replace(/\/+$/, '')
  if (path === '/api/admin/revalidate') return null // the route revalidates itself
  if (path.startsWith('/api/admin/') || path.startsWith('/api/tenant/')) return { kind: 'current' }
  if (path.startsWith('/api/superadmin/settings') || path.startsWith('/api/superadmin/plans')) return { kind: 'all' }
  if (path === '/api/stripe/webhooks') return { kind: 'all' }
  const tenantMatch = path.match(/^\/api\/superadmin\/tenants\/([^/]+)/)
  if (tenantMatch && UUID.test(tenantMatch[1])) return { kind: 'tenant', tenantId: tenantMatch[1].toLowerCase() }
  return null
}

/**
 * Apply the action. `currentSlug` is the request context's tenant slug (set by
 * getEffectiveTenant); a superadmin route's tenant is looked up by id. Never
 * throws: a missed invalidation only means the TTL does the work.
 */
export async function applyMenuCacheAction(action: MenuCacheAction | null, currentSlug: string | undefined): Promise<void> {
  if (!action) return
  try {
    if (action.kind === 'all') {
      revalidateAllPublicMenus()
    } else if (action.kind === 'current') {
      revalidatePublicMenu(currentSlug)
    } else {
      const { data } = await createServiceClient().from('tenants').select('slug').eq('id', action.tenantId).maybeSingle()
      revalidatePublicMenu(data?.slug)
    }
  } catch {
    // Swallowed on purpose: the response is already built; the TTL covers it.
  }
}
