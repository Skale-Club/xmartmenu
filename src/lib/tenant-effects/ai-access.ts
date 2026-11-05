import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { readPlatformAiRecord } from '../data/ai-access'
import { currentTenantEffectActor } from '../data/tenant-effect-authority-runtime'
import { requireTenantEffectActor } from '../data/tenant-effect-authority'
import { prepareTenantEffectCall,recordTenantEffectCall,reconcileTenantEffectCall } from '../data/tenant-effect-calls'
import { tenantEffectDigest,type TenantOperation } from '../data/tenant-effect-operations'
import { decryptApiKey } from '../crypto'
import { platformOpenRouterKey,OPENROUTER_BASE_URL } from '../ai/openrouter'
import { AdminMenuError } from '../data/admin-menus'

/** Existing superadmin services are platform cost, never customer billing.
 * This explicit native adapter cannot fall through the legacy access selector. */
export async function nativeEffectAiAccess(operation:TenantOperation,claimId:string,feature:'seed'|'ocr'|'seed_image',index=0,request:typeof fetch=fetch,workerNonce?:string) {
  const proof=await currentTenantEffectActor({actorId:operation.actorId,sessionHash:operation.sessionHash})
  const settings=await ownedAdminTransaction(false,async query=>{await requireTenantEffectActor(query,proof);return readPlatformAiRecord(query)})
  let panelKey:string|null=null
  if(settings?.openrouter_api_key){try{panelKey=decryptApiKey(settings.openrouter_api_key)}catch{}}
  const apiKey=panelKey??platformOpenRouterKey()
  if(!apiKey)throw new AdminMenuError(503,'AI is not configured on this server')
  let started=false
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input)),base=new URL(OPENROUTER_BASE_URL)
    if(url.origin!==base.origin || !url.pathname.startsWith(base.pathname+'/') || url.username || url.password || !['https:','http:'].includes(url.protocol)
      || (process.env.NODE_ENV==='production'&&url.protocol!=='https:') || started)throw new AdminMenuError(409,'Provider request cannot be repeated')
    const actor=await currentTenantEffectActor({actorId:operation.actorId,sessionHash:operation.sessionHash})
    await ownedAdminTransaction(true,query=>prepareTenantEffectCall(query,actor,operation.id,claimId,index,feature,{url:url.href,body:typeof init?.body==='string'?init.body:null},workerNonce))
    started=true
    try{
      const timeout=AbortSignal.timeout(125000)
      const response=await request(input,{...init,redirect:'error',signal:init?.signal?AbortSignal.any([init.signal,timeout]):timeout})
      if(!response.ok || !response.headers.get('content-type')?.includes('application/json'))throw new Error('Provider response is not a successful JSON receipt')
      const reader=response.clone().body?.getReader();if(!reader)throw new Error('Provider receipt body is unavailable')
      const chunks:Uint8Array[]=[];let size=0
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>24*1024*1024){void reader.cancel().catch(()=>{});throw new Error('Provider receipt exceeds the size limit')}chunks.push(part.value)}}finally{reader.releaseLock()}
      const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if(!body || typeof body!=='object' || Array.isArray(body) || !('usage'in body) || !body.usage || typeof body.usage!=='object' || Array.isArray(body.usage))throw new Error('Provider cost receipt is missing')
      const usage=body.usage as Record<string,unknown>,cost=usage.cost,tokens=usage.total_tokens??0
      if(typeof cost!=='number' || !Number.isFinite(cost) || cost<0 || typeof tokens!=='number' || !Number.isSafeInteger(tokens) || tokens<0)throw new Error('Provider cost receipt is invalid')
      const record=body as Record<string,unknown>
      await ownedAdminTransaction(true,query=>recordTenantEffectCall(query,operation.id,claimId,index,{feature,model:typeof record.model==='string'?record.model:null,generationId:typeof record.id==='string'?record.id:null,costUsd:cost,tokens,responseDigest:tenantEffectDigest(body)}))
      return response
    }catch{
      await ownedAdminTransaction(true,query=>reconcileTenantEffectCall(query,operation.id,claimId,index)).catch(()=>{})
      throw new AdminMenuError(409,'Provider outcome requires reconciliation. Do not repeat this paid operation.')
    }
  }
  return {apiKey,fetchImpl}
}
