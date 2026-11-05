import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import { lockTenantOperation,tenantEffectDigest } from './tenant-effect-operations'
import type { TenantEffectActor } from './tenant-effect-authority'

export type NativeCallReceipt={feature:'seed'|'ocr'|'seed_image'|'storage';model:string|null;generationId:string|null;costUsd:number|null;tokens:number;responseDigest:string}
export async function prepareTenantEffectCall(query:AdminMenuQuery,proof:TenantEffectActor,id:string,claimId:string,index:number,feature:NativeCallReceipt['feature'],request:unknown,workerNonce?:string) {
  const operation=await lockTenantOperation(query,proof,id)
  if(operation.claimId!==claimId || operation.status!=='running' || !Number.isInteger(index) || index<0 || index>=4000)throw new AdminMenuError(409,'Operation cannot start this provider call')
  if(workerNonce){
    const changed=(await query("UPDATE public.app_tenant_operation_calls SET status='sending',request_digest=$5 WHERE operation_id=$1 AND call_index=$2 AND claim_id=$3 AND worker_nonce=$4 AND status='prepared' RETURNING call_index",[id,index,claimId,workerNonce,tenantEffectDigest(request)])).rows
    if(changed.length!==1)throw new AdminMenuError(409,'Worker call claim was already consumed')
    return
  }
  if((await query('SELECT call_index FROM public.app_tenant_operation_calls WHERE operation_id=$1 AND call_index=$2 FOR UPDATE',[id,index])).rows.length)throw new AdminMenuError(409,'Provider call was already prepared; reconcile its outcome instead of retrying')
  await query("INSERT INTO public.app_tenant_operation_calls(operation_id,call_index,claim_id,status,request_digest,feature) VALUES($1,$2,$3,'sending',$4,$5)",[id,index,claimId,tenantEffectDigest(request),feature])
}
/** Internal claim capability permits recording facts about an already-started
 * call after actor revocation. It cannot apply generated catalog data, change
 * ownership or authorize another provider request. No browser endpoint accepts
 * claim IDs. No provider key/raw session token is present in this receipt. */
export async function recordTenantEffectCall(query:AdminMenuQuery,id:string,claimId:string,index:number,receipt:NativeCallReceipt) {
  if((receipt.feature==='storage'?receipt.costUsd!==null:typeof receipt.costUsd!=='number'||!Number.isFinite(receipt.costUsd)||receipt.costUsd<0) || !Number.isSafeInteger(receipt.tokens) || receipt.tokens<0 || !/^[a-f0-9]{64}$/.test(receipt.responseDigest)
    || (receipt.generationId!==null && receipt.generationId.length>256) || (receipt.model!==null && receipt.model.length>256))throw new AdminMenuError(503,'Provider receipt is invalid')
  const rows=(await query(`SELECT c.status,c.response_digest,c.feature,o.tenant_id,o.kind,o.input FROM public.app_tenant_operation_calls c JOIN public.app_tenant_operations o ON o.id=c.operation_id
    WHERE c.operation_id=$1 AND c.call_index=$2 AND c.claim_id=$3 AND o.claim_id=$3 FOR UPDATE OF c,o`,[id,index,claimId])).rows
  if(rows.length!==1 || rows[0].feature!==receipt.feature)throw new AdminMenuError(409,'Provider receipt claim mismatch')
  if(rows[0].status==='response' && rows[0].response_digest===receipt.responseDigest)return
  if(rows[0].status!=='sending')throw new AdminMenuError(409,'Provider receipt requires reconciliation')
  await query(`UPDATE public.app_tenant_operation_calls SET status='response',response_digest=$4,generation_id=$5,model=$6,cost_usd=$7,token_count=$8,completed_at=clock_timestamp()
    WHERE operation_id=$1 AND call_index=$2 AND claim_id=$3`,[id,index,claimId,receipt.responseDigest,receipt.generationId,receipt.model,receipt.costUsd,receipt.tokens])
  if(receipt.feature!=='storage'){
    await query(`INSERT INTO public.ai_usage_events(tenant_id,feature,model,key_source,billable,cost_usd,markup_pct,charge_usd,generation_id,request_id)
      VALUES($1,$2,$3,'platform',false,$4,0,0,$5,$6)`,[rows[0].tenant_id,receipt.feature,receipt.model,receipt.costUsd,receipt.generationId,id])
    const input=rows[0].input && typeof rows[0].input==='object'?rows[0].input as Record<string,unknown>:{}
    const featureKey=typeof input.type==='string'?input.type:rows[0].kind==='ocr'?'ocr':'image_seeding'
    await query(`INSERT INTO public.ai_usage(tenant_id,feature_key,date,call_count,token_count) VALUES($1,$2,(clock_timestamp() AT TIME ZONE 'UTC')::date,1,$3)
      ON CONFLICT(tenant_id,feature_key,date) DO UPDATE SET call_count=public.ai_usage.call_count+1,token_count=public.ai_usage.token_count+EXCLUDED.token_count`,[rows[0].tenant_id,featureKey,receipt.tokens])
  }
}
export async function reconcileTenantEffectCall(query:AdminMenuQuery,id:string,claimId:string,index:number) {
  // An unknown transport/COMMIT outcome never becomes permission to charge
  // again. A duplicate delivery only sees this stored non-retryable state.
  const rows=(await query(`UPDATE public.app_tenant_operations SET status='reconcile',outcome_code='provider_outcome_unknown'
    WHERE id=$1 AND claim_id=$2 AND status IN('running','generated') RETURNING id`,[id,claimId])).rows
  if(rows.length!==1)return
  await query("UPDATE public.app_tenant_operation_calls SET status='ambiguous',completed_at=clock_timestamp() WHERE operation_id=$1 AND claim_id=$2 AND call_index=$3 AND status IN('prepared','sending')",[id,claimId,index])
}
