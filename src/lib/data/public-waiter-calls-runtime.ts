import { ownedAdminTransaction } from './admin-menus-runtime'
import { createPublicWaiterCall } from './public-waiter-calls'

export const createOwnedPublicWaiterCall = (slug: string, tableId: string, reason: unknown) =>
  ownedAdminTransaction(true, query => createPublicWaiterCall(query, slug, tableId, reason))
