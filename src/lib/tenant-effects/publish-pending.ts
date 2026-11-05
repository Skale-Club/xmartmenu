import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { tenantEffectsSelected } from '../data/tenant-effect-authority-runtime'
import { UUID } from '../auth/owned-principal'
import { requireNativeQueue,publishNativeTenantWork } from './queue'

/** Trusted post-COMMIT handoff for tenant creation/subscription/MCP callers.
 * Only a previously committed native intention is published. A queue failure
 * leaves it pending and cannot turn a successful financial mutation into 503. */
export async function publishPendingNativeTenantEffects(tenantId:string):Promise<{queued:boolean;effectId?:string}> {
  if(!tenantEffectsSelected() || !UUID.test(tenantId))return {queued:false}
  try{
    requireNativeQueue('crm')
    const pending=await ownedAdminTransaction(false,async query=>{
      const rows=(await query("SELECT id,status FROM public.app_tenant_effects WHERE tenant_id=$1 AND status IN('pending','processing','reconcile') ORDER BY created_at,id LIMIT 1",[tenantId])).rows
      if(rows.length!==1 || rows[0].status!=='pending')return null
      const count=(await query("SELECT count(*)::text AS count FROM public.app_tenant_effects WHERE tenant_id=$1 AND status='delivered'",[tenantId])).rows[0]
      const step=Number(count?.count)
      if(!Number.isSafeInteger(step)||step<0)return null
      return {id:String(rows[0].id),step}
    })
    if(!pending)return {queued:false}
    await publishNativeTenantWork('crm',pending.id,pending.step)
    return {queued:true,effectId:pending.id}
  }catch{return {queued:false}}
}
