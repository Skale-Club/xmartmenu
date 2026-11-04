import { ownedAdminTransaction } from './admin-menus-runtime'
import { readNativeTenantCapabilities, readNativeTenantPlan, reconcileNativeSettings, reconcileNativeTenantPlan } from './tenant-plan'
import type { ServiceSettings } from '../service-modes'

export const readOwnedTenantPlan = (tenantId: string) => ownedAdminTransaction(false, query => readNativeTenantPlan(query, tenantId))
export const readOwnedTenantCapabilities = (tenantId: string, settings?: ServiceSettings | null) => ownedAdminTransaction(false, query => readNativeTenantCapabilities(query, tenantId, settings))
export const reconcileOwnedSettings = (tenantId: string, features: readonly string[] | null | undefined) => ownedAdminTransaction(true, query => reconcileNativeSettings(query, tenantId, features))
export const reconcileOwnedTenantPlan = (tenantId: string) => ownedAdminTransaction(true, query => reconcileNativeTenantPlan(query, tenantId))
