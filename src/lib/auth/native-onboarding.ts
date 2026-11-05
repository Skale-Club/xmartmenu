import type { AdminMenuQuery } from '../data/admin-menus'
import { UUID } from './owned-principal'
import { enqueueNativeTenantEffect,tenantEffectsSelected } from '../data/tenant-effects-outbox'

export class NativeOnboardingDenied extends Error {}
export async function nativeOnboarding(query: AdminMenuQuery, userId: string, sessionHash:string, input?: Record<string,unknown>) {
  if(!UUID.test(userId)||!/^[a-f0-9]{64}$/.test(sessionHash))throw new NativeOnboardingDenied('Current browser session required')
  await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
  // Lock the real server-selected profile; no preview tenant or client UID.
  const row = (await query(`SELECT p.tenant_id,p.role,p.must_change_password,a.disabled_at,
    EXISTS(SELECT 1 FROM public.menus m WHERE m.tenant_id=p.tenant_id) AS has_menu
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
    JOIN public.app_sessions s ON s.user_id=a.id AND s.token_hash=$2 AND s.session_version=a.session_version AND s.expires_at>clock_timestamp()
    JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=s.project_id AND b.subject=s.subject AND b.disabled_at IS NULL WHERE p.id=$1
    FOR UPDATE OF p,a FOR SHARE OF s,b`,[userId,sessionHash])).rows[0]
  if (!row || row.disabled_at || row.must_change_password || row.role === 'superadmin' || row.role === 'super-admin') throw new NativeOnboardingDenied('Account cannot onboard')
  if (!input) return { ready: !row.tenant_id || !row.has_menu }
  // Preserve canonical complete_onboarding's role/entry-plan/repair rules.
  // It creates tenant/settings/subscription/catalog and promotes the original
  // tenant-less profile in one transaction. It makes no Source Auth call.
  const result = (await query('SELECT public.complete_onboarding($1::uuid,$2::jsonb) AS result',[userId,JSON.stringify(input)])).rows[0]?.result
  if (!result || typeof result !== 'object') throw new Error('Onboarding failed')
  if(tenantEffectsSelected()){
    if(!('tenant_id'in result)||typeof result.tenant_id!=='string'||!UUID.test(result.tenant_id)||!('created_tenant'in result)||typeof result.created_tenant!=='boolean')throw new Error('Onboarding result is invalid')
    const effectId=await enqueueNativeTenantEffect(query,{tenantId:result.tenant_id,reason:result.created_tenant?'onboarded':'manual',...(result.created_tenant?{eventId:`onboarding:${result.tenant_id}`}:{})})
    const audit=(await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
      VALUES($1,$2,'server','app_tenant_effects',$3,'insert','{"operation":"onboarding_crm_intention"}'::jsonb) RETURNING id`,[result.tenant_id,userId,effectId])).rows
    if(audit.length!==1)throw new Error('Onboarding audit unavailable')
  }
  return { ...result,already_configured: !!row.tenant_id } as { tenant_id: string; tenant_slug: string; menu_slug: string; created_tenant: boolean; already_configured: boolean }
}
