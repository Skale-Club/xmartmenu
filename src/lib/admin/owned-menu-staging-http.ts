import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { hasSameOriginAdminMutation } from '@/lib/data/admin-display-settings'
import { ownedAdminTransaction } from '@/lib/data/admin-menus-runtime'
import { mutateMenuStaging, type MenuStagingMutation } from '@/lib/data/menu-staging'

const ACTIONS = new Set(['create', 'publish', 'rotate-link'])

/**
 * POST /api/admin/menus/[id]/staging  { action }
 *   create       [id] = the live menu → its staging copy (201)
 *   publish      [id] = a staging copy (or a replaced version) → swap into production
 *   rotate-link  [id] = a staging copy → new preview link (the old one stops working)
 * Discarding a staging copy is DELETE /api/admin/menus/[id].
 */
export async function ownedMenuStagingHttp(request: Request, id: string) {
  if (!adminMenusOwned()) return NextResponse.json({ error: 'Staging needs the owned database' }, { status: 501 })
  if (!hasSameOriginAdminMutation(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 })
  }
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await request.json().catch(() => null) as { action?: unknown } | null
    const action = typeof body?.action === 'string' && ACTIONS.has(body.action) ? body.action : null
    if (!action) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    const mutation: MenuStagingMutation = action === 'create' ? { kind: 'create', liveId: id } : { kind: action as 'publish' | 'rotate-link', id }
    // A copy writes a few statements per catalog table: use the pool's full budget.
    const result = await ownedAdminTransaction(true, query => mutateMenuStaging(query, { tenantId: effective.tenantId, role: effective.role }, mutation), 8000)
    return NextResponse.json(result, { status: action === 'create' ? 201 : 200 })
  } catch (error) {
    if (error instanceof AdminMenuError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Menu service is unavailable' }, { status: 503 })
  }
}
