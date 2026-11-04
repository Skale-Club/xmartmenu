import { ownedAdminTransaction } from './admin-menus-runtime'
import { authorizeAdminActor, type AdminActorContext } from './admin-actor'
import { readAiBillingAvailability, readAiPanelTenants, readAiUnbilledCharge, readAiUsageSummary, writeAiPlatformSettings, writeAiTenantSettings } from './ai-panel'

export const assertOwnedAiActor = (context: AdminActorContext) => ownedAdminTransaction(false, query => authorizeAdminActor(query, context))
export const readOwnedAiUsageSummary = (sinceIso: string, tenantId?: string) => ownedAdminTransaction(false, query => readAiUsageSummary(query, sinceIso, tenantId))
export const readOwnedAiUnbilledCharge = (tenantId: string) => ownedAdminTransaction(false, query => readAiUnbilledCharge(query, tenantId))
export const readOwnedAiPanelTenants = (context: AdminActorContext) => ownedAdminTransaction(false, query => readAiPanelTenants(query, context))
export const readOwnedAiBillingAvailability = (context: AdminActorContext) => ownedAdminTransaction(false, query => readAiBillingAvailability(query, context))
export const writeOwnedAiTenantSettings = (context: AdminActorContext, body: unknown, ownerOnly: boolean) => ownedAdminTransaction(true, query => writeAiTenantSettings(query, context, body, ownerOnly))
export const writeOwnedAiPlatformSettings = (context: AdminActorContext, body: unknown) => ownedAdminTransaction(true, query => writeAiPlatformSettings(query, context, body))
