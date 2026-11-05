import { PLATFORM_BASE } from '../seo'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { authorizeAdminActor } from './admin-actor'
import { readNativeChecklist, writeNativeChecklistItem } from '../mcp/data/checklist'
import type { LaunchChecklistStatus } from '../launch-checklist'

/** Same payload as the legacy loader; unverified sites resolve under the platform origin. */
export const loadOwnedLaunchChecklist = () =>
  ownedAdminTransaction(false, query => readNativeChecklist(query, PLATFORM_BASE))

/** Returns null when the restaurant does not exist (the route answers 404). */
export const setOwnedLaunchChecklistItem = (actorId: string, tenantId: string, itemKey: string, status: LaunchChecklistStatus, note?: string) =>
  ownedAdminTransaction(true, async query => {
    await authorizeAdminActor(query, { actorId, role: 'superadmin' }, true)
    if ((await query('SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE', [tenantId])).rows.length !== 1) return null
    return writeNativeChecklistItem(query, tenantId, itemKey, status, note, `superadmin:${actorId}`)
  })
