import { randomUUID } from 'node:crypto'
import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import type { TenantEffectActor } from './tenant-effect-authority'
import { requireTenantEffectActor } from './tenant-effect-authority'
import { lockTenantOperation,claimTenantOperation,finishTenantOperation,tenantEffectDigest,type TenantOperation } from './tenant-effect-operations'
import { UUID } from '../auth/owned-principal'

export const NATIVE_IMAGE_MIMES:Readonly<Record<string,string>>={'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'}
export async function prepareNativeUploadTicket(query:AdminMenuQuery,proof:TenantEffectActor,operation:TenantOperation) {
  const current=await lockTenantOperation(query,proof,operation.id)
  if(current.kind!=='ocr-upload')throw new AdminMenuError(400,'Not an OCR upload operation')
  const mime=String(current.input.contentType),size=Number(current.input.size),ext=NATIVE_IMAGE_MIMES[mime]
  if(!ext || !Number.isSafeInteger(size) || size<1 || size>15728640 || typeof current.input.contentDigest!=='string' || !/^[a-f0-9]{64}$/.test(current.input.contentDigest))throw new AdminMenuError(400,'Choose a supported image no larger than 15MB with its exact content digest')
  if(current.status==='applied'){
    const rows=(await query('SELECT storage_path,expires_at,byte_length,content_type FROM public.app_tenant_uploads WHERE operation_id=$1 AND actor_id=$2 AND actor_session_hash=$3 AND expires_at>clock_timestamp() AND consumed_by IS NULL',[operation.id,proof.actorId,proof.sessionHash])).rows
    if(rows.length!==1)throw new AdminMenuError(410,'This upload ticket expired or was already consumed. Start a new upload.')
    return rows[0]
  }
  if(current.status!=='reserved')throw new AdminMenuError(409,'Upload ticket operation is already in progress')
  const claim=await claimTenantOperation(query,proof,operation.id,tenantEffectDigest(current.input))
  if(!claim.claimId)throw new AdminMenuError(503,'Upload ticket claim is unavailable')
  const path=`${current.tenantId}/ocr/${randomUUID()}.${ext}`
  const rows=(await query(`INSERT INTO public.app_tenant_uploads(id,operation_id,tenant_id,actor_id,actor_session_hash,storage_path,content_type,byte_length,content_digest,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '5 minutes') RETURNING storage_path,expires_at,byte_length,content_type`,[randomUUID(),operation.id,current.tenantId,proof.actorId,proof.sessionHash,path,mime,size,current.input.contentDigest])).rows
  if(rows.length!==1)throw new AdminMenuError(503,'Upload ticket was not recorded')
  if(!(rows[0].expires_at instanceof Date))throw new AdminMenuError(503,'Upload ticket expiry is invalid')
  await finishTenantOperation(query,proof,operation.id,claim.claimId,{storagePath:path,expiresAt:rows[0].expires_at.toISOString()})
  return rows[0]
}
export async function nativeOperationStatus(query:AdminMenuQuery,proof:TenantEffectActor,tenantId:string,id:string) {
  await requireTenantEffectActor(query,proof)
  if(!UUID.test(id)||!UUID.test(tenantId))throw new AdminMenuError(400,'Invalid operation or tenant ID')
  const rows=(await query('SELECT status,outcome_code,result,next_index FROM public.app_tenant_operations WHERE id=$1 AND tenant_id=$2',[id,tenantId])).rows
  if(rows.length!==1)throw new AdminMenuError(404,'Operation not found for this restaurant')
  const row=rows[0],status=row.status==='applied'?'complete':row.status==='reserved'?'pending':row.status==='running'||row.status==='generated'?'running':'failed'
  return {status,errorMessage:status==='failed'?'This operation requires review. Do not repeat a paid request with an uncertain outcome.':null,
    ...(row.result&&typeof row.result==='object'&&'imagesCreated'in row.result?{imagesCreated:row.result.imagesCreated}:{}),nextIndex:Number(row.next_index??0)}
}
export async function consumeNativeOcrTicket(query:AdminMenuQuery,proof:TenantEffectActor,operation:TenantOperation,path:string) {
  await lockTenantOperation(query,proof,operation.id)
  const rows=(await query(`UPDATE public.app_tenant_uploads SET consumed_by=$1 WHERE storage_path=$2 AND tenant_id=$3 AND actor_id=$4 AND actor_session_hash=$5
    AND expires_at>clock_timestamp() AND consumed_by IS NULL RETURNING byte_length,content_type,content_digest`,[operation.id,path,operation.tenantId,operation.actorId,operation.sessionHash])).rows
  if(rows.length!==1)throw new AdminMenuError(409,'OCR upload is expired, already used or belongs to another session/tenant')
  return rows[0]
}
