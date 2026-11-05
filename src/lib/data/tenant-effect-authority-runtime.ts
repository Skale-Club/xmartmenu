import { ownedAdminTransaction } from './admin-menus-runtime'
import { tenantAdministrationContext } from './tenant-administration-runtime'
import type { TenantAdminContext } from './tenant-administration'
import { readTenantEffectSession,type TenantEffectActor } from './tenant-effect-authority'
import { getIdentityServices } from '../auth/identity-services'
import { assertProviderAccountActive } from '../auth/provider-account-status'
import { ownedAuthSelected } from '../auth/owned-principal'
import { AdminMenuError } from './admin-menus'

export const tenantEffectsSelected=(env:Record<string,string|undefined>=process.env)=>env.OWNED_TENANT_EFFECTS_ENABLED==='true'
export async function currentTenantEffectActor(context?:TenantAdminContext):Promise<TenantEffectActor> {
  if(!ownedAuthSelected() || !tenantEffectsSelected())throw new AdminMenuError(503,'Native tenant effects are unavailable')
  const selected=context ?? await tenantAdministrationContext()
  const session=await ownedAdminTransaction(false,query=>readTenantEffectSession(query,selected))
  const {config,customerAccount}=getIdentityServices()
  if(session.projectId!==config.web.projectId)throw new AdminMenuError(403,'Identity project mismatch')
  // Same existing users.get reader. No token, credentials or provider identity
  // is minted for either an HTTP operation or its scoped background job.
  assertProviderAccountActive(await customerAccount({projectId:session.projectId,subject:session.subject}),session.authenticatedAt)
  return {...selected,...session,checkedAt:Date.now()}
}
