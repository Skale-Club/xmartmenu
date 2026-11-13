import { BRAND_NAME } from '@/lib/brand'
import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {UUID} from '../../auth/owned-principal'
import {readNativeTenantPlan} from '../../data/tenant-plan'
import {createHash,timingSafeEqual} from 'node:crypto'
export type NativeBlogActor={actorId:string;sessionHash:string;scope:string|null;projectId:string;subject:string;authenticatedAt:number;checkedAt:number}
export type NativeBlogContext={kind:'browser';actor:NativeBlogActor}|{kind:'cron';scope:string|null}|{kind:'telegram';scope:string|null;settingsId:string;secretHash:string}
export const nativeBlogScope=(context:NativeBlogContext)=>context.kind==='browser'?context.actor.scope:context.scope
export async function requireNativeBlogContext(query:AdminMenuQuery,context:NativeBlogContext,write=false){
 if(context.kind==='browser')return requireNativeBlogActor(query,context.actor,write)
 const scope=context.scope
 if(scope!==null&&!UUID.test(scope))throw new AdminMenuError(403,'Invalid blog scope')
 if(write)await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
 let tenant={slug:'',name:BRAND_NAME}
 if(scope!==null){
  const row=(await query(`SELECT slug,name FROM public.tenants WHERE id=$1 AND is_active=true ${write?'FOR NO KEY UPDATE':''}`,[scope])).rows[0]
  if(!row||!(await readNativeTenantPlan(query,scope,write))?.features.includes('blog'))throw new AdminMenuError(403,'Blog capability unavailable')
  tenant={slug:String(row.slug),name:String(row.name)}
 }
 if(context.kind==='cron'){
  if(!(await query('SELECT id FROM public.blog_settings WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND enabled=true',[scope])).rows.length)throw new AdminMenuError(403,'Blog schedule disabled')
 }else{
  if(!UUID.test(context.settingsId)||!/^[a-f0-9]{64}$/.test(context.secretHash))throw new AdminMenuError(403,'Invalid Telegram proof')
  const row=(await query(`SELECT webhook_secret FROM public.telegram_settings WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid AND enabled=true AND approvals_enabled=true ${write?'FOR SHARE':''}`,[context.settingsId,scope])).rows[0]
  const actual=createHash('sha256').update(String(row?.webhook_secret??'')).digest()
  if(!row?.webhook_secret||!timingSafeEqual(actual,Buffer.from(context.secretHash,'hex')))throw new AdminMenuError(403,'Telegram proof changed')
 }
 return tenant
}
export async function requireNativeBlogActor(query:AdminMenuQuery,actor:NativeBlogActor,write=false) {
 if(!UUID.test(actor.actorId)||!/^[a-f0-9]{64}$/.test(actor.sessionHash)||(actor.scope!==null&&!UUID.test(actor.scope))||!Number.isSafeInteger(actor.checkedAt)||Date.now()-actor.checkedAt>5000||actor.checkedAt>Date.now()+5000)throw new AdminMenuError(403,'Current blog authority required')
 if(write)await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
 const rows=(await query(`SELECT p.role,p.tenant_id,s.authenticated_at,s.project_id,s.subject FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
  JOIN public.app_sessions s ON s.user_id=a.id JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=s.project_id AND b.subject=s.subject
  WHERE p.id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp() AND s.session_version=a.session_version
  AND a.disabled_at IS NULL AND b.disabled_at IS NULL AND NOT coalesce(p.must_change_password,false) ${write?'FOR SHARE OF p,a,s,b':''}`,[actor.actorId,actor.sessionHash])).rows
 const row=rows[0]
 if(rows.length!==1||!(row.authenticated_at instanceof Date)||Math.floor(row.authenticated_at.getTime()/1000)!==actor.authenticatedAt||row.project_id!==actor.projectId||row.subject!==actor.subject
  ||(actor.scope===null?!['superadmin','super-admin'].includes(String(row.role)):row.tenant_id!==actor.scope||!['admin','store-admin','store-staff'].includes(String(row.role))))throw new AdminMenuError(403,'Current blog authority required')
 if(actor.scope!==null){
  const tenant=(await query(`SELECT id,slug,name FROM public.tenants WHERE id=$1 AND is_active=true ${write?'FOR NO KEY UPDATE':''}`,[actor.scope])).rows[0]
  if(!tenant||!(await readNativeTenantPlan(query,actor.scope,write))?.features.includes('blog'))throw new AdminMenuError(403,'Blog capability unavailable')
  return {slug:String(tenant.slug),name:String(tenant.name)}
 }
 return {slug:'',name:BRAND_NAME}
}
export async function lockNativeBlogScope(query:AdminMenuQuery,scope:string|null){
 await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-blog:'||coalesce($1::text,'platform'),0))",[scope])
}
