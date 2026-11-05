import { randomUUID } from 'node:crypto'
import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import { UUID } from '../auth/owned-principal'
import { readNativeTenantPlan } from './tenant-plan'
import { buildSyncPayload } from '../xphere/mapping'
import type { SyncReason,XphereSyncRequest,XphereSyncResponse } from '../xphere/types'
import { NATIVE_SYNC_REASONS } from './tenant-effects-outbox'
import { tenantEffectDigest } from './tenant-effect-operations'

export type NativeCrmFacts={id:string;status:string;tenantId:string;reason:SyncReason;eventId?:string;tags:string[];tenant:Record<string,unknown>;owner:Record<string,unknown>|null;plan:NonNullable<Awaited<ReturnType<typeof readNativeTenantPlan>>>;currency:string;digest:string}
export type NativeCrmPayload=XphereSyncRequest & {company:XphereSyncRequest['company'] & {phone?:string|null}}
export async function readNativeCrmFacts(query:AdminMenuQuery,id:string,lock=false):Promise<NativeCrmFacts|null> {
  if(!UUID.test(id))throw new AdminMenuError(400,'Invalid CRM intention')
  if(lock)await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
  const effects=(await query(`SELECT * FROM public.app_tenant_effects WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows
  if(effects.length!==1)return null
  const effect=effects[0]
  if(!effect.tenant_id)return null
  if(!NATIVE_SYNC_REASONS.includes(effect.kind as SyncReason) || !Array.isArray(effect.tags) || effect.tags.some(tag=>typeof tag!=='string'))throw new AdminMenuError(503,'CRM intention is invalid')
  const tenants=(await query(`SELECT id,slug,name,custom_domain FROM public.tenants WHERE id=$1 ${lock?'FOR NO KEY UPDATE':''}`,[effect.tenant_id])).rows
  if(tenants.length!==1)return null
  const tenant=tenants[0],plan=await readNativeTenantPlan(query,String(tenant.id),lock)
  if(!plan)throw new AdminMenuError(409,'Restaurant has no current subscription')
  const owners=(await query(`SELECT p.id,p.full_name,p.role,a.session_version,b.project_id,b.subject FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
    JOIN public.app_identity_bindings b ON b.user_id=p.id AND b.disabled_at IS NULL
    WHERE p.tenant_id=$1 AND p.role IN('admin','store-admin') AND NOT coalesce(p.must_change_password,false) AND a.disabled_at IS NULL
    ORDER BY p.id,CASE WHEN b.provider='phone' THEN 0 ELSE 1 END,b.project_id,b.subject LIMIT 1 ${lock?'FOR SHARE OF p,a,b':''}`,[tenant.id])).rows
  const settings=(await query('SELECT currency FROM public.tenant_settings WHERE tenant_id=$1',[tenant.id])).rows
  const owner=owners[0]??null,currency=String(settings[0]?.currency??'brl')
  if(!/^[A-Za-z]{3}$/.test(currency))throw new AdminMenuError(503,'Restaurant currency is invalid')
  const facts={id,status:String(effect.status),tenantId:String(tenant.id),reason:effect.kind as SyncReason,
    ...(effect.event_id?{eventId:String(effect.event_id)}:{}),tags:effect.tags as string[],tenant,owner,plan,currency}
  return {...facts,digest:tenantEffectDigest({...facts,status:undefined})}
}
export async function claimNativeCrmEffect(query:AdminMenuQuery,id:string,observed:NativeCrmFacts,phone:string|null,checkedAt:number) {
  const current=await readNativeCrmFacts(query,id,true)
  if(!current)return {skipped:'tenant-gone'} as const
  if(current.status==='delivered' || current.status==='cancelled' || current.status==='failed' || current.status==='reconcile')return {skipped:current.status} as const
  if(current.status==='processing') {
    // A previous process may still be running or may have sent the note before
    // crashing. Never steal its claim, re-send or invalidate a live receipt.
    // A stranded processing claim needs explicit operator reconciliation.
    return {skipped:'processing'} as const
  }
  const earlier=(await query("SELECT id FROM public.app_tenant_effects WHERE tenant_id=$1 AND status IN('pending','processing','reconcile') ORDER BY created_at,id LIMIT 1 FOR UPDATE",[current.tenantId])).rows
  if(earlier.length!==1 || earlier[0].id!==id)throw new AdminMenuError(503,'An earlier CRM intention must finish or be reconciled first')
  if(current.status!=='pending' || current.digest!==observed.digest || Date.now()-checkedAt>5000 || checkedAt>Date.now()+5000)throw new AdminMenuError(409,'CRM facts changed; no request was sent')
  if(phone!==null && !/^\+[1-9]\d{7,14}$/.test(phone))throw new AdminMenuError(503,'Verified owner phone is invalid')
  const payload:NativeCrmPayload=buildSyncPayload({tenant:{id:current.tenantId,name:String(current.tenant.name),slug:String(current.tenant.slug),custom_domain:typeof current.tenant.custom_domain==='string'?current.tenant.custom_domain:null},
    owner:current.owner?{full_name:typeof current.owner.full_name==='string'?current.owner.full_name:null,role:'store-admin',email:null}:null,
    plan:current.plan,currency:current.currency,reason:current.reason,occurredAt:new Date().toISOString(),eventId:current.eventId,tags:current.tags})
  if(current.owner)payload.company.phone=phone
  const claimId=randomUUID(),requestDigest=tenantEffectDigest(payload)
  await query("UPDATE public.app_tenant_effects SET status='processing',claim_id=$2,claimed_at=clock_timestamp(),observed_at=$3,request_digest=$4,request_payload=$5::jsonb WHERE id=$1",[id,claimId,payload.occurred_at,requestDigest,JSON.stringify(payload)])
  return {claimId,payload,requestDigest,tenantId:current.tenantId} as const
}
export function verifiedNativeCrmResponse(value:unknown):XphereSyncResponse {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new AdminMenuError(503,'CRM response requires reconciliation')
  const body=value as Record<string,unknown>
  if(body.ok!==true || typeof body.account_id!=='string' || !UUID.test(body.account_id) || typeof body.opportunity_id!=='string' || !UUID.test(body.opportunity_id)
    || (body.contact_id!==null && (typeof body.contact_id!=='string' || !UUID.test(body.contact_id))))throw new AdminMenuError(503,'CRM response requires reconciliation')
  return {ok:true,account_id:body.account_id,opportunity_id:body.opportunity_id,contact_id:body.contact_id as string|null}
}
export async function completeNativeCrmEffect(query:AdminMenuQuery,id:string,claimId:string,requestDigest:string,response:XphereSyncResponse) {
  const verified=verifiedNativeCrmResponse(response)
  const rows=(await query("SELECT tenant_id FROM public.app_tenant_effects WHERE id=$1 AND claim_id=$2 AND request_digest=$3 AND status='processing' FOR UPDATE",[id,claimId,requestDigest])).rows
  if(rows.length!==1 || !rows[0].tenant_id)throw new AdminMenuError(409,'CRM receipt claim changed')
  const changed=(await query(`UPDATE public.tenants SET xphere_account_id=$2,xphere_contact_id=coalesce($3,xphere_contact_id),xphere_opportunity_id=$4,
    xphere_synced_at=clock_timestamp(),xphere_sync_error=NULL WHERE id=$1 RETURNING id`,[rows[0].tenant_id,verified.account_id,verified.contact_id,verified.opportunity_id])).rows
  if(changed.length!==1)throw new AdminMenuError(409,'CRM tenant changed')
  await query("UPDATE public.app_tenant_effects SET status='delivered',response_digest=$3,outcome_code='provider_confirmed',completed_at=clock_timestamp() WHERE id=$1 AND claim_id=$2",[id,claimId,tenantEffectDigest(verified)])
  const audit=(await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
    VALUES($1,NULL,'server','app_tenant_effects',$2,'update','{"operation":"crm_provider_receipt"}'::jsonb) RETURNING id`,[rows[0].tenant_id,id])).rows
  if(audit.length!==1)throw new AdminMenuError(503,'CRM receipt audit is unavailable')
}
export async function reconcileNativeCrmEffect(query:AdminMenuQuery,id:string,claimId:string,code='provider_outcome_unknown') {
  if(!['provider_outcome_unknown','provider_response_invalid','receipt_commit_unknown','provider_rejected'].includes(code))throw new AdminMenuError(400,'Invalid CRM outcome')
  await query("UPDATE public.app_tenant_effects SET status='reconcile',outcome_code=$3 WHERE id=$1 AND claim_id=$2 AND status='processing'",[id,claimId,code])
}
