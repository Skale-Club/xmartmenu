import { createHash,randomUUID } from 'node:crypto'
import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import { UUID } from '../auth/owned-principal'
import { requireTenantEffectActor,type TenantEffectActor } from './tenant-effect-authority'

export type TenantOperationKind='seed'|'image'|'image-job'|'ocr'|'upload'|'ocr-upload'
export type TenantOperation={id:string;tenantId:string;actorId:string;sessionHash:string;kind:TenantOperationKind;input:Record<string,unknown>;status:string;claimId:string|null;result:unknown}
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value && typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}'
  return JSON.stringify(value) ?? 'null'
}
export const tenantEffectDigest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex')
export function operationRow(row:Record<string,unknown>):TenantOperation {
  if(!row.input || typeof row.input!=='object' || Array.isArray(row.input))throw new AdminMenuError(503,'Native operation input is unavailable')
  return {id:String(row.id),tenantId:String(row.tenant_id),actorId:String(row.actor_id),sessionHash:String(row.actor_session_hash),kind:row.kind as TenantOperationKind,
    input:row.input as Record<string,unknown>,status:String(row.status),claimId:row.claim_id ? String(row.claim_id) : null,result:row.result}
}
async function operationAudit(query:AdminMenuQuery,proof:TenantEffectActor,operation:TenantOperation,action:string) {
  const rows=(await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
    VALUES($1,$2,'server','app_tenant_operations',$3,'update',$4::jsonb) RETURNING id`,[operation.tenantId,proof.actorId,operation.id,JSON.stringify({operation:action})])).rows
  if(rows.length!==1)throw new AdminMenuError(503,'Native operation audit is unavailable')
}
export async function reserveTenantOperation(query:AdminMenuQuery,proof:TenantEffectActor,tenantId:string,kind:TenantOperationKind,key:string,input:Record<string,unknown>) {
  await requireTenantEffectActor(query,proof,true)
  if(!UUID.test(tenantId) || !UUID.test(key))throw new AdminMenuError(400,'An explicit operation key and tenant are required')
  if(!(await query('SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE',[tenantId])).rows.length)throw new AdminMenuError(404,'Restaurant not found')
  const prior=(await query('SELECT * FROM public.app_tenant_operations WHERE actor_id=$1 AND tenant_id=$2 AND kind=$3 AND request_key=$4 FOR UPDATE',[proof.actorId,tenantId,kind,key])).rows
  const digest=tenantEffectDigest(input)
  if(prior.length){if(prior.length!==1 || prior[0].input_digest!==digest || prior[0].actor_session_hash!==proof.sessionHash)throw new AdminMenuError(409,'Operation key already belongs to another request');return operationRow(prior[0])}
  const id=randomUUID(),rows=(await query(`INSERT INTO public.app_tenant_operations(id,tenant_id,actor_id,actor_session_hash,request_key,kind,input_digest,input,menu_id,category_id,product_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING *`,[id,tenantId,proof.actorId,proof.sessionHash,key,kind,digest,JSON.stringify(input),input.menuId??null,input.categoryId??null,input.productId??null])).rows
  if(rows.length!==1)throw new AdminMenuError(503,'Native operation could not be reserved')
  const operation=operationRow(rows[0]);await operationAudit(query,proof,operation,'reserve');return operation
}
export async function lockTenantOperation(query:AdminMenuQuery,proof:TenantEffectActor,id:string) {
  await requireTenantEffectActor(query,proof,true)
  if(!UUID.test(id))throw new AdminMenuError(404,'Operation not found')
  const rows=(await query('SELECT * FROM public.app_tenant_operations WHERE id=$1 AND actor_id=$2 AND actor_session_hash=$3 FOR UPDATE',[id,proof.actorId,proof.sessionHash])).rows
  if(rows.length!==1)throw new AdminMenuError(404,'Operation not found')
  const operation=operationRow(rows[0])
  if(!(await query('SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE',[operation.tenantId])).rows.length)throw new AdminMenuError(404,'Restaurant not found')
  return operation
}
export async function claimTenantOperation(query:AdminMenuQuery,proof:TenantEffectActor,id:string,snapshotDigest:string) {
  const operation=await lockTenantOperation(query,proof,id)
  if(operation.status!=='reserved')throw new AdminMenuError(409,'This operation was already started; inspect its status instead of repeating provider work')
  const claimId=randomUUID()
  await query("UPDATE public.app_tenant_operations SET claim_id=$2,status='running',snapshot_digest=$3 WHERE id=$1",[id,claimId,snapshotDigest])
  await operationAudit(query,proof,operation,'claim')
  return {...operation,status:'running',claimId}
}
export async function finishTenantOperation(query:AdminMenuQuery,proof:TenantEffectActor,id:string,claimId:string,result:unknown) {
  const operation=await lockTenantOperation(query,proof,id)
  if(operation.claimId!==claimId || !['running','generated'].includes(operation.status))throw new AdminMenuError(409,'Operation claim changed')
  await query("UPDATE public.app_tenant_operations SET status='applied',result=$3::jsonb,completed_at=clock_timestamp() WHERE id=$1 AND claim_id=$2",[id,claimId,JSON.stringify(result)])
  await operationAudit(query,proof,operation,'apply')
  return result
}
