import { ownedAdminTransaction } from './admin-menus-runtime'
import type { AdminStoreContext } from './admin-store-settings'
import { markAdminCustomDomainVerified, mutateAdminCustomDomain, mutateAdminServiceSettings, mutateAdminStoreSettings, readAdminStorePage } from './admin-store-settings'

export const readOwnedStorePage = (context: AdminStoreContext) =>
  ownedAdminTransaction(false, query => readAdminStorePage(query, context))

export const mutateOwnedStoreSettings = (context: AdminStoreContext, patch: unknown) =>
  ownedAdminTransaction(true, query => mutateAdminStoreSettings(query, context, patch))

export const mutateOwnedServiceSettings = (context: AdminStoreContext, patch: unknown) =>
  ownedAdminTransaction(true, query => mutateAdminServiceSettings(query, context, patch))

export const mutateOwnedCustomDomain = (context: AdminStoreContext, tenantId: string, domain: unknown) =>
  ownedAdminTransaction(true, query => mutateAdminCustomDomain(query, context, tenantId, domain))

export const markOwnedCustomDomainVerified = (context: AdminStoreContext, tenantId: string, domain: string, verified: boolean) =>
  ownedAdminTransaction(true, query => markAdminCustomDomainVerified(query, context, tenantId, domain, verified))
