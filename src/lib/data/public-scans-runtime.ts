import { ownedAdminTransaction } from './admin-menus-runtime'
import { recordPublicScan } from './public-scans'

export const recordOwnedPublicScan = (tenantId: unknown) =>
  ownedAdminTransaction(true, query => recordPublicScan(query, tenantId))
