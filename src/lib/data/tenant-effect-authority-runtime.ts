import { ownedAdminTransaction } from './admin-menus-runtime'
import { tenantAdministrationContext } from './tenant-administration-runtime'
import { readTenantEffectSession,type TenantEffectActor,type TenantEffectSessionContext } from './tenant-effect-authority'
import { getIdentityServices } from '../auth/identity-services'
import { assertProviderAccountActive } from '../auth/provider-account-status'
import { ownedAuthSelected } from '../auth/owned-principal'
import { AdminMenuError } from './admin-menus'
import { tenantEffectsSelected } from './tenant-effects-outbox'
export { tenantEffectsSelected } from './tenant-effects-outbox'

export async function currentTenantEffectActor(context?:TenantEffectSessionContext):Promise<TenantEffectActor> {
  if(!ownedAuthSelected() || !tenantEffectsSelected())throw new AdminMenuError(503,'Native tenant effects are unavailable')
  const candidate=context ?? await tenantAdministrationContext()
  if(!('sessionHash'in candidate) || typeof candidate.sessionHash!=='string')throw new AdminMenuError(403,'A current browser session is required for this effect')
  const selected={actorId:candidate.actorId,sessionHash:candidate.sessionHash}
  const session=await ownedAdminTransaction(false,query=>readTenantEffectSession(query,selected))
  const {config,customerAccount}=getIdentityServices()
  if(session.projectId!==config.web.projectId)throw new AdminMenuError(403,'Identity project mismatch')
  // Same existing users.get reader. No token, credentials or provider identity
  // is minted for either an HTTP operation or its scoped background job.
  assertProviderAccountActive(await customerAccount({projectId:session.projectId,subject:session.subject}),session.authenticatedAt)
  return {...selected,...session,checkedAt:Date.now()}
}
