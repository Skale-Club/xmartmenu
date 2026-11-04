import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { getOwnedPrincipal } from '../auth/owned-principal-runtime'
import { ownedAuthSelected, ownedSessionToken } from '../auth/owned-principal'
import { getIdentityServices } from '../auth/identity-services'
import { assertProviderAccountActive } from '../auth/provider-account-status'
import { requireCurrentPhone } from '../auth/google-customer-account'
import type { VerifiedGoogleIdentity } from '../auth/google-identity'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { AdminMenuError } from './admin-menus'
import { accountAdministrationSelected, listAdminAccounts, listStaffAccounts, changeAccountAccess, disableAccount, removeStaffAccount,
  issueStaffAccess, completeStaffAccess, type AccountAdminContext } from './account-administration'

export function requireAccountAdministration() {
  if (!accountAdministrationSelected() || !ownedAuthSelected()) throw new AdminMenuError(503,'Native account administration is unavailable')
}
export async function accountAdministrationContext(tenantId?: string,platformOnly = false): Promise<AccountAdminContext> {
  requireAccountAdministration()
  const principal = await getOwnedPrincipal()
  if (!principal || principal.mustChangePassword || !['superadmin','store-admin'].includes(principal.role)) throw new AdminMenuError(403,'Current administrator access is required')
  const current = await headers(), { config } = getIdentityServices()
  const token = ownedSessionToken(current.get('cookie'),new URL(config.origin).protocol === 'https:')
  if (!token) throw new AdminMenuError(401,'Sign in again')
  return { actorId:principal.userId,sessionHash:createHash('sha256').update(token).digest('hex'),platformOnly,...(tenantId ? { tenantId } : {}) }
}
export const readOwnedAdminAccounts = async () => {
  const context = await accountAdministrationContext()
  return ownedAdminTransaction(false,query => listAdminAccounts(query,context))
}
export async function readOwnedAccountUsersPage() {
  const context = await accountAdministrationContext()
  return ownedAdminTransaction(false,async query => {
    const users = await listAdminAccounts(query,context)
    const tenants = (await query('SELECT id,name,slug FROM public.tenants ORDER BY name,id LIMIT 1001')).rows
    if (tenants.length > 1000) throw new AdminMenuError(409,'Tenant list exceeds the supported limit')
    return { users,tenants,currentUserId:context.actorId }
  })
}
export const readOwnedStaffAccounts = async (tenantId: string,platformOnly = false) => {
  const context = await accountAdministrationContext(tenantId,platformOnly)
  return ownedAdminTransaction(false,query => listStaffAccounts(query,context))
}
export async function accountAdministrationMutation(action: 'update'|'disable'|'remove-staff'|'invite'|'recovery', id: string, body?: unknown, tenantId?: string,platformOnly = false) {
  const context = await accountAdministrationContext(tenantId,platformOnly)
  return ownedAdminTransaction<unknown>(true,query => {
    switch (action) {
      case 'update': return changeAccountAccess(query,context,id,body)
      case 'disable': return disableAccount(query,context,id)
      case 'remove-staff': return removeStaffAccount(query,context,id)
      case 'invite': return issueStaffAccess(query,context,id,'invite')
      case 'recovery': return issueStaffAccess(query,context,id,'recovery')
    }
  })
}
/** Existing provider reader + existing native session store; no provider creation or new pool. */
export async function completeOwnedStaffAccess(identity: VerifiedGoogleIdentity, code: string, kind: 'invite'|'recovery') {
  requireAccountAdministration()
  const { config,store,customerAccount } = getIdentityServices()
  if (identity.projectId !== config.web.projectId) throw new AdminMenuError(401,'Identity project mismatch')
  const status = await customerAccount(identity)
  assertProviderAccountActive(status,identity.authenticatedAt)
  if (identity.provider === 'phone') requireCurrentPhone(status,identity.authenticatedAt,identity.phone!)
  const checkedAt = Date.now(), userId = await store.owner(identity)
  if (!userId) throw new AdminMenuError(403,'Use the verified sign-in method already linked to the invited account. Lost factors require independent reviewed recovery.')
  await ownedAdminTransaction(true,query => completeStaffAccess(query,{ userId,projectId:identity.projectId,subject:identity.subject,
    authenticatedAt:identity.authenticatedAt,checkedAt },kind,code))
  // The atomic version bump invalidates older devices. Never retry the grant
  // transaction if this final live check/session creation fails; normal verified
  // sign-in can resume the already-accepted account without replaying the link.
  return store.createSession(identity)
}
