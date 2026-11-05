import { ownedAdminTransaction } from './admin-menus-runtime'
import { authorizeAdminActor } from './admin-actor'
import { readTenantProductPicker } from './superadmin-reads'

export const readOwnedTenantProductPicker = (actorId: string, tenantId: string, menuId: string) =>
  ownedAdminTransaction(false, async query => {
    await authorizeAdminActor(query, { actorId, role: 'superadmin' })
    return readTenantProductPicker(query, tenantId, menuId)
  })
