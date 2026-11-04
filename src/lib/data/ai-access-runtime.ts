import { ownedAdminTransaction } from './admin-menus-runtime'
import { insertAiUsageRecord, readPlatformAiRecord, readTenantAiRecord, recordTenantAiKeyError, type AiUsageRecord } from './ai-access'

export const readOwnedPlatformAiRecord = () => ownedAdminTransaction(false, readPlatformAiRecord)
export const readOwnedTenantAiRecord = (tenantId: string) => ownedAdminTransaction(false, query => readTenantAiRecord(query, tenantId))
export const recordOwnedTenantAiKeyError = (tenantId: string, message: string, occurredAt: string) =>
  ownedAdminTransaction(true, query => recordTenantAiKeyError(query, tenantId, message, occurredAt))
export const insertOwnedAiUsageRecord = (row: AiUsageRecord) => ownedAdminTransaction(true, query => insertAiUsageRecord(query, row))
