import { NextResponse } from 'next/server'
import { AdminMenuError } from '../data/admin-menus'
import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { currentTenantEffectActor } from '../data/tenant-effect-authority-runtime'
import { requireTenantEffectActor } from '../data/tenant-effect-authority'
import { reserveTenantOperation,tenantEffectByteDigest,type TenantOperationKind } from '../data/tenant-effect-operations'
import { prepareNativeUploadTicket,nativeOperationStatus,NATIVE_IMAGE_MIMES } from '../data/tenant-effect-uploads'
import { readTenantEffectCatalog } from '../data/tenant-effect-catalog'
import { enqueueNativeTenantEffect } from '../data/tenant-effects-outbox'
import { hasSameOriginAdminMutation } from '../data/admin-display-settings'
import { tenantAdminBody } from '../admin/owned-tenant-administration-http'
import { getNativeStorageClient } from '../storage'
import { isXphereEnabled } from '../xphere/client'
import { UUID } from '../auth/owned-principal'
import { nativeEffectInput } from './input'
import { nativeMultipartImage } from './upload'
import { executeNativeSeed,executeNativeSingleImage,executeNativeOcr,executeNativeUpload } from './execute'
import { requireNativeQueue,publishNativeTenantWork } from './queue'
import { publishPendingNativeTenantEffects } from './publish-pending'

const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
const denied=(error:unknown,tenantId:string,operationId?:string)=>json({error:error instanceof AdminMenuError&&error.status<500?error.message:error instanceof SyntaxError?'Invalid JSON body':'Native tenant effect is unavailable',...(operationId?{operationId}:{}),
  ...(operationId?{reviewUrl:`/api/superadmin/tenants/${tenantId}/seed-status?jobId=${encodeURIComponent(operationId)}`}:{})},error instanceof AdminMenuError&&error.status<500?error.status:error instanceof SyntaxError?400:503)
function requestKey(request:Request) {const key=request.headers.get('idempotency-key');if(!key||!UUID.test(key))throw new AdminMenuError(400,'An explicit Idempotency-Key UUID is required');return key}
export async function nativeTenantEffectHttp(kind:TenantOperationKind|'status'|'resync',request:Request,tenantId:string) {
  let operationId:string|undefined
  try{
    if(!UUID.test(tenantId))throw new AdminMenuError(400,'Invalid restaurant ID')
    let proof=await currentTenantEffectActor()
    if(request.method!=='GET'&&!hasSameOriginAdminMutation(request))throw new AdminMenuError(403,'Origin mismatch')
    if(request.method==='GET'&&request.headers.get('sec-fetch-site')==='cross-site')throw new AdminMenuError(403,'Origin mismatch')
    if(kind==='status'){
      const id=new URL(request.url).searchParams.get('jobId')??new URL(request.url).searchParams.get('operationId')??''
      return json(await ownedAdminTransaction(false,query=>nativeOperationStatus(query,proof,tenantId,id)))
    }
    const key=requestKey(request)
    if(kind==='resync'){
      requireNativeQueue('crm');if(!isXphereEnabled())throw new AdminMenuError(503,'CRM sync is not configured')
      const effectId=await ownedAdminTransaction(true,async query=>{
        await requireTenantEffectActor(query,proof,true)
        if(!(await query('SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE',[tenantId])).rows.length)throw new AdminMenuError(404,'Restaurant not found')
        const id=await enqueueNativeTenantEffect(query,{tenantId,reason:'manual',eventId:`manual:${key}`})
        const audit=(await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
          VALUES($1,$2,'server','app_tenant_effects',$3,'insert','{"operation":"manual_crm_intention"}'::jsonb) RETURNING id`,[tenantId,proof.actorId,id])).rows
        if(audit.length!==1)throw new AdminMenuError(503,'CRM intention audit is unavailable')
        return id
      })
      const {queued}=await publishPendingNativeTenantEffects(tenantId)
      return json({effectId,queued,status:'pending',message:queued?'CRM intention queued. Delivery is not yet confirmed.':'CRM intention saved. Queue delivery is pending; do not create another intention to retry.'},202)
    }
    if(kind==='ocr-upload'){
      const storage=getNativeStorageClient(),params=new URL(request.url).searchParams,size=Number(params.get('size')),contentType=params.get('contentType')??'',filename=params.get('filename')??'menu',contentDigest=params.get('contentDigest')??''
      if(!Number.isSafeInteger(size)||size<1||size>15728640||!NATIVE_IMAGE_MIMES[contentType]||filename.length>256||!/^[a-f0-9]{64}$/.test(contentDigest))throw new AdminMenuError(400,'A supported image type, exact content digest and size up to 15MB are required')
      const operation=await ownedAdminTransaction(true,query=>reserveTenantOperation(query,proof,tenantId,'ocr-upload',key,{size,contentType,filename,contentDigest}))
      operationId=operation.id;proof=await currentTenantEffectActor({actorId:proof.actorId,sessionHash:proof.sessionHash})
      const ticket=await ownedAdminTransaction(true,query=>prepareNativeUploadTicket(query,proof,operation))
      if(!(ticket.expires_at instanceof Date))throw new AdminMenuError(503,'Upload expiry is unavailable')
      const expires=Math.min(300,Math.floor((ticket.expires_at.getTime()-Date.now())/1000))
      if(expires<1)throw new AdminMenuError(410,'Upload ticket expired')
      const uploadUrl=await storage.createNativeSignedUploadUrl('tenant-assets',String(ticket.storage_path),size,contentType,expires)
      return json({operationId,uploadUrl,storagePath:ticket.storage_path,expiresAt:ticket.expires_at.toISOString()})
    }
    if(kind==='upload'){
      getNativeStorageClient();const file=await nativeMultipartImage(request)
      proof=await currentTenantEffectActor({actorId:proof.actorId,sessionHash:proof.sessionHash})
      const operation=await ownedAdminTransaction(true,query=>reserveTenantOperation(query,proof,tenantId,'upload',key,{type:file.type,contentDigest:tenantEffectByteDigest(file.original)}))
      operationId=operation.id
      if(operation.status==='applied')return json(operation.result)
      if(operation.status!=='reserved')throw new AdminMenuError(409,'Upload already started; inspect its outcome')
      return json(await executeNativeUpload(operation,file.bytes,file.type))
    }
    const raw=await tenantAdminBody(request),input=nativeEffectInput(kind,raw)
    let effectiveKind=kind
    if(kind==='image'&&input.type==='image_products')effectiveKind='image-job'
    if(effectiveKind==='image-job'){
      requireNativeQueue('ai');getNativeStorageClient()
      proof=await currentTenantEffectActor({actorId:proof.actorId,sessionHash:proof.sessionHash})
      if(!input.menuId){
        input.menuId=await ownedAdminTransaction(false,async query=>{
          await requireTenantEffectActor(query,proof)
          const rows=input.productId?(await query('SELECT menu_id AS id FROM public.products WHERE tenant_id=$1 AND id=$2',[tenantId,input.productId])).rows
            :(await query('SELECT id FROM public.menus WHERE tenant_id=$1 ORDER BY is_default DESC,position,id LIMIT 1',[tenantId])).rows
          if(rows.length!==1||typeof rows[0].id!=='string'||!UUID.test(rows[0].id))throw new AdminMenuError(404,'No exact menu is available for this image job')
          return rows[0].id
        })
      }
    }
    proof=await currentTenantEffectActor({actorId:proof.actorId,sessionHash:proof.sessionHash})
    const operation=await ownedAdminTransaction(true,async query=>{
      const snapshot=await readTenantEffectCatalog(query,proof,tenantId,String(input.menuId),true)
      if(input.productId&&!snapshot.products.some(row=>row.id===input.productId))throw new AdminMenuError(404,'Product not found for this menu')
      if(input.categoryId&&!snapshot.categories.some(row=>row.id===input.categoryId))throw new AdminMenuError(404,'Category not found for this menu')
      return reserveTenantOperation(query,proof,tenantId,effectiveKind,key,input)
    })
    operationId=operation.id
    if(operation.status==='applied')return json(operation.result)
    if(effectiveKind==='image-job'){
      if(!['reserved','running'].includes(operation.status))throw new AdminMenuError(409,'Image job needs review before another dispatch')
      let queued=true;try{await publishNativeTenantWork('ai',operation.id,operation.nextIndex??0)}catch{queued=false}
      return json({jobId:operation.id,menuId:input.menuId,queued,status:operation.status==='reserved'?'pending':'running'},202)
    }
    if(operation.status!=='reserved')throw new AdminMenuError(409,'This operation already started. Inspect its outcome instead of repeating the paid request.')
    return json(effectiveKind==='seed'?await executeNativeSeed(operation):effectiveKind==='ocr'?await executeNativeOcr(operation):await executeNativeSingleImage(operation))
  }catch(error){return denied(error,tenantId,operationId)}
}
