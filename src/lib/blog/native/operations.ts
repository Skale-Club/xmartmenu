import {randomUUID} from 'node:crypto'
import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {tenantEffectDigest} from '../../data/tenant-effect-operations'
import {chargeFor,type KeyChoice} from '../../ai/billing-rules'
import {requireNativeBlogContext,requireNativeBlogActor,nativeBlogScope,lockNativeBlogScope,type NativeBlogContext,type NativeBlogActor} from './authority'
import {nativeBlogAudit} from './admin-data'
/** Generation is at most two text calls, one image call and one upload (about five minutes). A longer `running` row survived a restart. */
export const NATIVE_BLOG_RUNNING_TTL_MINUTES=15
/** Cover calls are optional: their failure or ambiguity never blocks the paid post. */
export const NATIVE_BLOG_COVER_CALLS=[2,3]
export type NativeBlogOperation={id:string;scope:string|null;claimId:string|null;status:string;result:Record<string,unknown>|null;input:Record<string,unknown>;settingsDigest:string|null}
const operation=(row:Record<string,unknown>):NativeBlogOperation=>({id:String(row.id),scope:row.tenant_id===null?null:String(row.tenant_id),claimId:row.claim_id===null?null:String(row.claim_id),status:String(row.status),result:row.result as Record<string,unknown>|null,input:row.input as Record<string,unknown>,settingsDigest:row.settings_digest===null?null:String(row.settings_digest)})
export async function reserveNativeBlogOperation(query:AdminMenuQuery,context:NativeBlogContext,kind:'generation'|'telegram-settings'|'telegram-send'|'telegram-callback',key:string,input:Record<string,unknown>,inputDigest?:string,blocking=true){
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
 if(kind==='generation'||kind==='telegram-settings')await expireStaleNativeBlogOperations(query,scope,kind)
 if(blocking&&(kind==='generation'||kind==='telegram-settings')&&(await query("SELECT id FROM public.app_blog_operations WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND kind=$2 AND status IN('running','reconcile') LIMIT 1",[scope,kind])).rows.length)throw new AdminMenuError(409,'An earlier blog operation needs review before another attempt')
 const id=randomUUID(),row=(await query(`INSERT INTO public.app_blog_operations(id,tenant_id,actor_id,actor_session_hash,authenticated_at,kind,request_key,input_digest,input,actor_project_id,actor_subject)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,[id,scope,actor?.actorId??null,actor?.sessionHash??null,actor?new Date(actor.authenticatedAt*1000):null,kind,key,digest,JSON.stringify(input),actor?.projectId??null,actor?.subject??null])).rows[0]
 await nativeBlogAudit(query,actor?.actorId??null,scope,id,'blog_operation_reserved','app_blog_operations','insert')
 return operation(row)
}
/** A `running` row older than the TTL cannot still be executing: move it to the reviewable `reconcile` state (never silently to success or failure) so a deploy mid-call leaves a visible record instead of an invisible block. */
export async function expireStaleNativeBlogOperations(query:AdminMenuQuery,scope:string|null,kind?:string){
 const rows=(await query(`UPDATE public.app_blog_operations SET status='reconcile',outcome_code='expired_running' WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND ($2::text IS NULL OR kind=$2) AND status='running' AND created_at<clock_timestamp()-make_interval(mins=>$3::int) RETURNING id,generation_job_id`,[scope,kind??null,NATIVE_BLOG_RUNNING_TTL_MINUTES])).rows
 for(const row of rows){
  await query("UPDATE public.app_blog_calls SET status='ambiguous' WHERE operation_id=$1 AND status='sending'",[row.id])
  if(row.generation_job_id)await query("UPDATE public.blog_generation_jobs SET status='failed',error_message='Interrupted; operation needs review',completed_at=clock_timestamp() WHERE id=$1 AND status='running'",[row.generation_job_id])
 }
 return rows.length
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
/** Definitive refusal (4xx, malformed or unusable body): terminal `failed`, never blocks the next attempt. */
export async function failNativeBlogOperation(query:AdminMenuQuery,id:string,claimId:string,code:string){
 await query("UPDATE public.app_blog_operations SET status='failed',outcome_code=$3,completed_at=clock_timestamp() WHERE id=$1 AND claim_id=$2 AND status='running'",[id,claimId,code.slice(0,100)])
}
/** A response was received and carried no usable output: close the call as known (no usage fact, nothing billed by us). */
export async function recordNativeBlogCallFailure(query:AdminMenuQuery,id:string,claimId:string,index:number,payload:Record<string,unknown>){
 await query("UPDATE public.app_blog_calls SET status='response',response_digest=$4,response_payload=$5::jsonb,completed_at=clock_timestamp() WHERE operation_id=$1 AND call_index=$2 AND claim_id=$3 AND status='sending'",[id,index,claimId,tenantEffectDigest(payload),JSON.stringify({...payload,failed:true})])
}
/** Optional cover work with an unknown outcome stays reviewable on the call, without touching the post's operation. */
export async function ambiguousNativeBlogCoverCalls(query:AdminMenuQuery,id:string,claimId:string){
 await query("UPDATE public.app_blog_calls SET status='ambiguous' WHERE operation_id=$1 AND claim_id=$2 AND status='sending' AND call_index=ANY($3::int[])",[id,claimId,NATIVE_BLOG_COVER_CALLS])
}
/** Audited superadmin repair: closes a stuck `reconcile` (or expired `running`) operation as `failed` so the tenant can try again. It never replays or applies output. */
export async function repairNativeBlogOperation(query:AdminMenuQuery,actor:NativeBlogActor,id:string){
 if(actor.scope!==null)throw new AdminMenuError(403,'Platform administrator required')
 await requireNativeBlogActor(query,actor,true)
 const row=(await query('SELECT * FROM public.app_blog_operations WHERE id=$1 FOR UPDATE',[id])).rows[0]
 if(!row)throw new AdminMenuError(404,'Blog operation not found')
 const stale=row.status==='running'&&row.created_at instanceof Date&&Date.now()-row.created_at.getTime()>NATIVE_BLOG_RUNNING_TTL_MINUTES*60000
 if(row.status!=='reconcile'&&!stale)throw new AdminMenuError(409,'Only an operation awaiting review can be repaired')
 await query("UPDATE public.app_blog_operations SET status='failed',outcome_code='repaired_by_superadmin',completed_at=clock_timestamp() WHERE id=$1",[id])
 await query("UPDATE public.app_blog_calls SET status='ambiguous' WHERE operation_id=$1 AND status='sending'",[id])
 if(row.generation_job_id)await query("UPDATE public.blog_generation_jobs SET status='failed',error_message='Closed by an administrator after review',completed_at=clock_timestamp() WHERE id=$1 AND status='running'",[row.generation_job_id])
 await nativeBlogAudit(query,actor.actorId,row.tenant_id===null?null:String(row.tenant_id),id,'blog_operation_repaired','app_blog_operations','update')
 return {ok:true,id,previousStatus:String(row.status)}
}
export async function listUnresolvedNativeBlogOperations(query:AdminMenuQuery,actor:NativeBlogActor){
 if(actor.scope!==null)throw new AdminMenuError(403,'Platform administrator required')
 await requireNativeBlogActor(query,actor)
 return (await query("SELECT id,tenant_id,kind,status,outcome_code,created_at FROM public.app_blog_operations WHERE status IN('running','reconcile') ORDER BY created_at,id LIMIT 200")).rows.map(row=>({id:String(row.id),tenantId:row.tenant_id===null?null:String(row.tenant_id),kind:String(row.kind),status:String(row.status),outcomeCode:row.outcome_code===null?null:String(row.outcome_code),createdAt:row.created_at instanceof Date?row.created_at.toISOString():null}))
}
export async function finishNativeBlogOperation(query:AdminMenuQuery,context:NativeBlogContext,id:string,claimId:string,result:Record<string,unknown>){
 const current=await lockNativeBlogOperation(query,context,id,claimId)
 if(current.status!=='running'||(await query("SELECT operation_id FROM public.app_blog_calls WHERE operation_id=$1 AND status<>'response' AND NOT(call_index=ANY($2::int[]) AND status='ambiguous') LIMIT 1",[id,NATIVE_BLOG_COVER_CALLS])).rows.length)throw new AdminMenuError(409,'Blog operation requires reconciliation')
 await query("UPDATE public.app_blog_operations SET status='completed',result=$3::jsonb,completed_at=clock_timestamp() WHERE id=$1 AND claim_id=$2",[id,claimId,JSON.stringify(result)])
 await nativeBlogAudit(query,context.kind==='browser'?context.actor.actorId:null,current.scope,id,'blog_operation_completed','app_blog_operations')
}
