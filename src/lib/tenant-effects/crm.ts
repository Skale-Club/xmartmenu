import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { readNativeCrmFacts,claimNativeCrmEffect,completeNativeCrmEffect,reconcileNativeCrmEffect,verifiedNativeCrmResponse,type NativeCrmPayload } from '../data/native-crm-effects'
import { getIdentityServices } from '../auth/identity-services'
import { isXphereEnabled,postXphereSync } from '../xphere/client'
import { XpherePermanentError } from '../xphere/errors'
import type { PostXphereResult } from '../xphere/client'
import { publishPendingNativeTenantEffects } from './publish-pending'

export async function dispatchNativeCrmEffect(id:string,send:(payload:NativeCrmPayload,options:{idempotencyKey:string})=>Promise<PostXphereResult>=postXphereSync) {
  // A disabled integration leaves the intention pending. It is never marked
  // delivered merely because the legacy client's dark/no-op result is 2xx.
  if(!isXphereEnabled())return {status:'pending',reason:'crm-disabled'}
  const observed=await ownedAdminTransaction(false,query=>readNativeCrmFacts(query,id))
  if(!observed)return {status:'cancelled',reason:'tenant-gone'}
  if(['delivered','cancelled','failed','reconcile','processing'].includes(observed.status))return {status:observed.status}
  let phone:string|null=null
  if(observed.owner){
    const {config,customerAccount}=getIdentityServices()
    if(observed.owner.project_id!==config.web.projectId)throw new Error('CRM owner project mismatch')
    const metadata=await customerAccount({projectId:String(observed.owner.project_id),subject:String(observed.owner.subject)})
    if(!metadata.disabled)phone=metadata.phoneE164
  }
  const checkedAt=Date.now(),claim=await ownedAdminTransaction(true,query=>claimNativeCrmEffect(query,id,observed,phone,checkedAt))
  if('skipped'in claim)return {status:claim.skipped}
  let sent=false
  try{
    sent=true
    const result=await send(claim.payload,{idempotencyKey:`xmartmenu-native:${id}`})
    if(result.disabled){
      // The gate changed after claiming. Preserve the claim as unresolved;
      // automatic re-send cannot distinguish every transport outcome.
      await ownedAdminTransaction(true,query=>reconcileNativeCrmEffect(query,id,claim.claimId))
      return {status:'reconcile'}
    }
    const response=verifiedNativeCrmResponse(result.response)
    await ownedAdminTransaction(true,query=>completeNativeCrmEffect(query,id,claim.claimId,claim.requestDigest,response))
    await publishPendingNativeTenantEffects(claim.tenantId).catch(()=>{})
    return {status:'delivered'}
  }catch(error){
    // Network/2xx parse errors, uncertain COMMIT and permanent errors cannot
    // trigger an automatic resend of the append-only remote note.
    if(sent)await ownedAdminTransaction(true,query=>reconcileNativeCrmEffect(query,id,claim.claimId,error instanceof XpherePermanentError?'provider_rejected':'provider_outcome_unknown')).catch(()=>{})
    return {status:'reconcile'}
  }
}
