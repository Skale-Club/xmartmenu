import {randomUUID} from 'node:crypto'
import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {tenantEffectDigest} from '../../data/tenant-effect-operations'
import {chargeFor,type KeyChoice} from '../../ai/billing-rules'
import {requireNativeBlogContext,nativeBlogScope,lockNativeBlogScope,type NativeBlogContext} from './authority'
import {nativeBlogAudit} from './admin-data'
export type NativeBlogOperation={id:string;scope:string|null;claimId:string|null;status:string;result:Record<string,unknown>|null;input:Record<string,unknown>;settingsDigest:string|null}
const operation=(row:Record<string,unknown>):NativeBlogOperation=>({id:String(row.id),scope:row.tenant_id===null?null:String(row.tenant_id),claimId:row.claim_id===null?null:String(row.claim_id),status:String(row.status),result:row.result as Record<string,unknown>|null,input:row.input as Record<string,unknown>,settingsDigest:row.settings_digest===null?null:String(row.settings_digest)})
export async function reserveNativeBlogOperation(query:AdminMenuQuery,context:NativeBlogContext,kind:'generation'|'telegram-settings'|'telegram-send'|'telegram-callback',key:string,input:Record<string,unknown>,inputDigest?:string){
 if(!key||key.length>256||JSON.stringify(input).length>131072)throw new AdminMenuError(400,'Invalid blog operation')
 const scope=nativeBlogScope(context)
 await requireNativeBlogContext(query,context,true);await lockNativeBlogScope(query,scope)
 const existing=(await query('SELECT * FROM public.app_blog_operations WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND kind=$2 AND request_key=$3 FOR UPDATE',[scope,kind,key])).rows[0]
 const digest=inputDigest??tenantEffectDigest(input),actor=context.kind==='browser'?context.actor:null
 if(!/^[a-f0-9]{64}$/.test(digest))throw new AdminMenuError(400,'Invalid blog request digest')
 if(existing){
  if(existing.input_digest!==digest||existing.actor_id!==(actor?.actorId??null)||existing.actor_session_hash!==(actor?.sessionHash??null)||existing.actor_project_id!==(actor?.projectId??null)||existing.actor_subject!==(actor?.subject??null))throw new AdminMenuError(409,'Blog request key belongs to a different operation')
  return operation(existing)
 }
 if((kind==='generation'||kind==='telegram-settings')&&(await query("SELECT id FROM public.app_blog_operations WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND kind=$2 AND status IN('running','reconcile') LIMIT 1",[scope,kind])).rows.length)throw new AdminMenuError(409,'An earlier blog operation needs review before another attempt')
 const id=randomUUID(),row=(await query(`INSERT INTO public.app_blog_operations(id,tenant_id,actor_id,actor_session_hash,authenticated_at,kind,request_key,input_digest,input,actor_project_id,actor_subject)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,[id,scope,actor?.actorId??null,actor?.sessionHash??null,actor?new Date(actor.authenticatedAt*1000):null,kind,key,digest,JSON.stringify(input),actor?.projectId??null,actor?.subject??null])).rows[0]
 await nativeBlogAudit(query,actor?.actorId??null,scope,id,'blog_operation_reserved','app_blog_operations','insert')
 return operation(row)
}
export async function lockNativeBlogOperation(query:AdminMenuQuery,context:NativeBlogContext,id:string,claimId?:string){
 await requireNativeBlogContext(query,context,true);await lockNativeBlogScope(query,nativeBlogScope(context))
 const row=(await query('SELECT * FROM public.app_blog_operations WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE',[id,nativeBlogScope(context)])).rows[0]
 const actor=context.kind==='browser'?context.actor:null
 if(!row||row.actor_id!==(actor?.actorId??null)||row.actor_session_hash!==(actor?.sessionHash??null)||row.actor_project_id!==(actor?.projectId??null)||row.actor_subject!==(actor?.subject??null)||(claimId&&row.claim_id!==claimId))throw new AdminMenuError(403,'Blog operation authority changed')
 return operation(row)
}
export async function claimNativeBlogOperation(query:AdminMenuQuery,context:NativeBlogContext,id:string,settingsDigest:string){
 const current=await lockNativeBlogOperation(query,context,id)
 if(current.status!=='reserved')throw new AdminMenuError(409,'Blog operation already started; inspect its outcome')
 const claimId=randomUUID()
 const row=(await query("UPDATE public.app_blog_operations SET status='running',claim_id=$2,settings_digest=$3 WHERE id=$1 RETURNING *",[id,claimId,settingsDigest])).rows[0]
 return operation(row)
}
export async function prepareNativeBlogCall(query:AdminMenuQuery,context:NativeBlogContext,id:string,claimId:string,index:number,kind:'ai'|'telegram'|'storage',request:unknown,choice?:KeyChoice,model?:string){
 const current=await lockNativeBlogOperation(query,context,id,claimId)
 if(current.status!=='running')throw new AdminMenuError(409,'Blog operation needs review')
 if(!Number.isInteger(index)||index<0||index>100)throw new AdminMenuError(400,'Invalid blog call')
 const rows=(await query(`INSERT INTO public.app_blog_calls(operation_id,call_index,claim_id,kind,status,request_digest,model,key_source,billable,markup_pct)
  VALUES($1,$2,$3,$4,'sending',$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING operation_id`,[id,index,claimId,kind,tenantEffectDigest(request),model??null,choice?.keySource??null,choice?.billable??false,choice?.markupPct??0])).rows
 if(rows.length!==1)throw new AdminMenuError(409,'Blog call already prepared; never replay it automatically')
}
/** Internal claim capability records a known provider fact after revocation;
 * it cannot authorize a new call or apply output. No HTTP accepts this proof. */
export async function recordNativeBlogCall(query:AdminMenuQuery,id:string,claimId:string,index:number,payload:Record<string,unknown>,fact?:{costUsd:number;generationId:string|null;tokens:number|null;inputTokens:number|null;outputTokens:number|null}){
 const row=(await query('SELECT c.*,o.tenant_id FROM public.app_blog_calls c JOIN public.app_blog_operations o ON o.id=c.operation_id WHERE c.operation_id=$1 AND c.call_index=$2 AND c.claim_id=$3 FOR UPDATE OF c',[id,index,claimId])).rows[0]
 const digest=tenantEffectDigest(payload)
 if(!row)throw new AdminMenuError(409,'Blog call receipt unavailable')
 if(row.status==='response'){if(row.response_digest!==digest)throw new AdminMenuError(409,'Blog receipt changed');return}
 if(row.status!=='sending'||JSON.stringify(payload).length>2097152)throw new AdminMenuError(409,'Blog receipt requires review')
 if(row.kind==='ai'&&(!fact||!Number.isFinite(fact.costUsd)||fact.costUsd<0||(fact.tokens!==null&&(!Number.isSafeInteger(fact.tokens)||fact.tokens<0))))throw new AdminMenuError(409,'Actual provider usage required')
 const charge=fact?chargeFor(fact.costUsd,row.billable===true,Number(row.markup_pct)):null
 await query("UPDATE public.app_blog_calls SET status='response',response_digest=$4,response_payload=$5::jsonb,generation_id=$6,cost_usd=$7,charge_usd=$8,token_count=$9,completed_at=clock_timestamp() WHERE operation_id=$1 AND call_index=$2 AND claim_id=$3",[id,index,claimId,digest,JSON.stringify(payload),fact?.generationId??null,fact?.costUsd??null,charge,fact?.tokens??null])
 if(fact){
  await query(`INSERT INTO public.ai_usage_events(tenant_id,feature,model,key_source,billable,cost_usd,markup_pct,charge_usd,generation_id,request_id)
   VALUES($1,'blog',$2,$3,$4,$5,$6,$7,$8,$9)`,[row.tenant_id,row.model,row.key_source,row.billable,fact.costUsd,row.markup_pct,charge,fact.generationId,`${id}:${index}`])
  await query(`INSERT INTO public.ai_generation_logs(tenant_id,step,provider,model,input_tokens,output_tokens,cost_usd,status)
   VALUES($1,'blog_post','openrouter',$2,$3,$4,$5,'success')`,[row.tenant_id,row.model,fact.inputTokens,fact.outputTokens,fact.costUsd])
 }
}
export async function reconcileNativeBlogOperation(query:AdminMenuQuery,id:string,claimId:string){
 await query("UPDATE public.app_blog_operations SET status='reconcile',outcome_code='provider_or_commit_unknown' WHERE id=$1 AND claim_id=$2 AND status='running'",[id,claimId])
 await query("UPDATE public.app_blog_calls SET status='ambiguous' WHERE operation_id=$1 AND claim_id=$2 AND status='sending'",[id,claimId])
}
export async function finishNativeBlogOperation(query:AdminMenuQuery,context:NativeBlogContext,id:string,claimId:string,result:Record<string,unknown>){
 const current=await lockNativeBlogOperation(query,context,id,claimId)
 if(current.status!=='running'||(await query("SELECT operation_id FROM public.app_blog_calls WHERE operation_id=$1 AND status<>'response' LIMIT 1",[id])).rows.length)throw new AdminMenuError(409,'Blog operation requires reconciliation')
 await query("UPDATE public.app_blog_operations SET status='completed',result=$3::jsonb,completed_at=clock_timestamp() WHERE id=$1 AND claim_id=$2",[id,claimId,JSON.stringify(result)])
 await nativeBlogAudit(query,context.kind==='browser'?context.actor.actorId:null,current.scope,id,'blog_operation_completed','app_blog_operations')
}
