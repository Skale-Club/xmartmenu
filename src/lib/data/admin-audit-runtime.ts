import { ownedAdminTransaction } from './admin-menus-runtime'
import { readOwnerAuditPage, readPlatformAuditPage, type AuditFilters } from './admin-audit'
import type { UserRole } from '@/types/database'

export const readOwnedOwnerAuditPage = (context: { tenantId: string; role: UserRole }, filters: AuditFilters) =>
  ownedAdminTransaction(false, query => readOwnerAuditPage(query, context, filters))

export const readOwnedPlatformAuditPage = (context: { role: UserRole }, filters: AuditFilters) =>
  ownedAdminTransaction(false, query => readPlatformAuditPage(query, context, filters))
