import { randomUUID } from 'node:crypto'
import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import type { TenantEffectActor } from './tenant-effect-authority'
import { lockTenantOperation,claimTenantOperation,tenantEffectDigest,finishTenantOperation } from './tenant-effect-operations'
import { readTenantEffectCatalog } from './tenant-effect-catalog'

/** One paid image per signed delivery. A duplicate observes a prepared slot,
 * never receives its worker nonce and cannot repeat that provider request. */
export async function prepareNativeImageStep(query:AdminMenuQuery,proof:TenantEffectActor,id:string) {
  let operation=await lockTenantOperation(query,proof,id)
  if(operation.kind!=='image-job')throw new AdminMenuError(400,'Not an image job')
  if(['applied','failed','rejected','reconcile'].includes(operation.status))return {state:operation.status,result:operation.result} as const
  const snapshot=await readTenantEffectCatalog(query,proof,operation.tenantId,String(operation.input.menuId),true)
  if(operation.status==='reserved'){
    const candidates=operation.input.productId?snapshot.products.filter(row=>row.id===operation.input.productId):snapshot.products.filter(row=>row.image_url===null)
    if(operation.input.productId && !candidates.length)throw new AdminMenuError(404,'Product not found for this menu')
    const targets=candidates.filter(row=>!row.image_url).map(row=>String(row.id))
    operation=await claimTenantOperation(query,proof,id,snapshot.digest)
    operation={...operation,imageTargets:targets,nextIndex:0}
    await query('UPDATE public.app_tenant_operations SET image_targets=$2::uuid[] WHERE id=$1',[id,targets])
  }
  const claimId=operation.claimId
  if(operation.status!=='running' || !claimId)throw new AdminMenuError(409,'Image job claim is unavailable')
  const index=operation.nextIndex??0,targets=operation.imageTargets??[]
  if(index>=targets.length){const result=operation.result??{success:true,imagesCreated:0,message:'No products need images.'};await finishTenantOperation(query,proof,id,claimId,result);return {state:'applied',result} as const}
  const product=snapshot.products.find(row=>row.id===targets[index])
  if(!product)throw new AdminMenuError(409,'Image job product was removed')
  const slot=(await query('SELECT call_index FROM public.app_tenant_operation_calls WHERE operation_id=$1 AND call_index=$2 FOR UPDATE',[id,index*2])).rows
  if(slot.length)return {state:'processing'} as const
  if(product.image_url){await query('UPDATE public.app_tenant_operations SET next_index=next_index+1 WHERE id=$1',[id]);return {state:'continue',nextIndex:index+1} as const}
  const workerNonce=randomUUID()
  await query(`INSERT INTO public.app_tenant_operation_calls(operation_id,call_index,claim_id,worker_nonce,status,request_digest,feature)
    VALUES($1,$2,$3,$4,'prepared',$5,'seed_image')`,[id,index*2,claimId,workerNonce,tenantEffectDigest({product,menu:snapshot.menu})])
  return {state:'ready',operation,claimId,index,workerNonce,snapshot,product} as const
}
export async function advanceNativeImageStep(query:AdminMenuQuery,proof:TenantEffectActor,id:string,claimId:string,index:number) {
  const operation=await lockTenantOperation(query,proof,id)
  if(operation.claimId!==claimId || operation.status!=='running' || operation.nextIndex!==index)throw new AdminMenuError(409,'Image step changed')
  const calls=(await query("SELECT call_index FROM public.app_tenant_operation_calls WHERE operation_id=$1 AND call_index IN($2,$2+1) AND claim_id=$3 AND status='response' FOR UPDATE",[id,index*2,claimId])).rows
  if(calls.length!==2)throw new AdminMenuError(409,'Image step has no confirmed AI/storage receipts')
  const previous=operation.result && typeof operation.result==='object' && 'imagesCreated'in operation.result?Number(operation.result.imagesCreated):0
  if(!Number.isInteger(previous) || previous<0 || previous>=2000)throw new AdminMenuError(503,'Image job progress is invalid')
  const result={success:true,imagesCreated:previous+1,message:`${previous+1} product images generated and uploaded.`}
  await query('UPDATE public.app_tenant_operations SET next_index=$2,result=$3::jsonb WHERE id=$1',[id,index+1,JSON.stringify(result)])
  const done=index+1>=(operation.imageTargets??[]).length
  if(done)await finishTenantOperation(query,proof,id,claimId,result)
  return {state:done?'applied':'continue',nextIndex:index+1,result}
}
