import { ownedAdminTransaction } from './admin-menus-runtime'
import { readAdminWaiterCalls, updateAdminWaiterCall, type AdminWaiterContext } from './admin-waiter-calls'

export const readOwnedAdminWaiterCalls = (context: AdminWaiterContext) =>
  ownedAdminTransaction(false,query => readAdminWaiterCalls(query,context))
export const updateOwnedAdminWaiterCall = (context: AdminWaiterContext, id: string, status: unknown) =>
  ownedAdminTransaction(true,query => updateAdminWaiterCall(query,context,id,status))
