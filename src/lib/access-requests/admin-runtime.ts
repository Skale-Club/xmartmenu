import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { tenantAdministrationContext } from '../data/tenant-administration-runtime'
import { approveAccessRequest, declineAccessRequest, listAccessRequests, reopenAccessRequest } from './store'

/**
 * Superadmin review of access requests on the owned database. The store
 * functions re-verify the platform administrator inside the transaction; this
 * layer only supplies the verified request context.
 */
export async function ownedAccessRequests() {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(false, query => listAccessRequests(query, context))
}
export async function ownedApproveAccessRequest(id: string, input: unknown) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(true, query => approveAccessRequest(query, context, id, input))
}
export async function ownedDeclineAccessRequest(id: string, input: unknown) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(true, query => declineAccessRequest(query, context, id, input))
}
export async function ownedReopenAccessRequest(id: string) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(true, query => reopenAccessRequest(query, context, id))
}
