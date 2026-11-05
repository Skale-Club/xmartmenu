import { NextResponse } from 'next/server'
import { AdminMenuError } from '../data/admin-menus'
import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { currentTenantEffectActor } from '../data/tenant-effect-authority-runtime'
import { requireTenantEffectActor } from '../data/tenant-effect-authority'
import { enqueueNativeTenantEffectBatch } from '../data/tenant-effects-backfill'
import { hasSameOriginAdminMutation } from '../data/admin-display-settings'
import { UUID } from '../auth/owned-principal'
import { isXphereEnabled } from '../xphere/client'
import { requireNativeQueue } from './queue'
import { publishPendingNativeTenantEffects } from './publish-pending'

export async function nativeTenantEffectsBackfill(request:Request) {
  const respond=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
  try {
    if(!hasSameOriginAdminMutation(request))throw new AdminMenuError(403,'Origin mismatch')
    const key=request.headers.get('idempotency-key')??''
    if(!UUID.test(key))throw new AdminMenuError(400,'An explicit Idempotency-Key UUID is required')
    requireNativeQueue('crm')
    if(!isXphereEnabled())throw new AdminMenuError(503,'CRM sync is not configured')
    const proof=await currentTenantEffectActor(),cursor=new URL(request.url).searchParams.get('cursor')
    const batch=await ownedAdminTransaction(true,async query=>{
      await requireTenantEffectActor(query,proof,true)
      const result=await enqueueNativeTenantEffectBatch(query,proof,{requestKey:key,cursor})
      await requireTenantEffectActor(query,proof,true)
      return result
    })
    let queued=0
    for(const intention of batch.intentions){
      try{if((await publishPendingNativeTenantEffects(intention.tenantId)).queued)queued++}catch{/* Already committed; retain pending. */}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    return respond({saved:batch.intentions.length,queued,pending:batch.intentions.length-queued,status:'pending',nextCursor:batch.nextCursor,done:batch.done},202)
  }catch(error){return respond({error:error instanceof AdminMenuError&&error.status<500?error.message:'Native backfill is unavailable'},error instanceof AdminMenuError?error.status:503)}
}
