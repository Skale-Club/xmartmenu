import { ownedAdminTransaction } from './admin-menus-runtime'
import type { StoreOperationsContext, RestaurantTableMutation } from './admin-store-operations'
import { createAdminQrCode, deleteAdminQrCode, mutateAdminRestaurantTable, readAdminQrCodes, readAdminRestaurantTables } from './admin-store-operations'

export const readOwnedQrCodes = (context: StoreOperationsContext) =>
  ownedAdminTransaction(false, query => readAdminQrCodes(query, context))

export const createOwnedQrCode = (context: StoreOperationsContext, label: unknown, targetUrl: string) =>
  ownedAdminTransaction(true, query => createAdminQrCode(query, context, label, targetUrl))

export const deleteOwnedQrCode = (context: StoreOperationsContext, id: string) =>
  ownedAdminTransaction(true, query => deleteAdminQrCode(query, context, id))

export const readOwnedRestaurantTables = (context: StoreOperationsContext) =>
  ownedAdminTransaction(false, query => readAdminRestaurantTables(query, context))

export const mutateOwnedRestaurantTable = (context: StoreOperationsContext, mutation: RestaurantTableMutation) =>
  ownedAdminTransaction(true, query => mutateAdminRestaurantTable(query, context, mutation))
