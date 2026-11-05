import { ownedAdminTransaction } from './admin-menus-runtime'
import { readOwnedWaiterData } from './owned-waiter'

export const readOwnedWaiter = (slug: string) => ownedAdminTransaction(false, query => readOwnedWaiterData(query, slug))
