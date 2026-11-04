import type { AdminMenuQuery } from '../data/admin-menus'

export class NativeOnboardingDenied extends Error {}
export async function nativeOnboarding(query: AdminMenuQuery, userId: string, input?: Record<string,unknown>) {
  // Lock the real server-selected profile; no preview tenant or client UID.
  const row = (await query(`SELECT p.tenant_id,p.role,p.must_change_password,a.disabled_at,
    EXISTS(SELECT 1 FROM public.menus m WHERE m.tenant_id=p.tenant_id) AS has_menu
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id WHERE p.id=$1
    FOR UPDATE OF p,a`,[userId])).rows[0]
  if (!row || row.disabled_at || row.must_change_password || row.role === 'superadmin') throw new NativeOnboardingDenied('Account cannot onboard')
  if (!input) return { ready: !row.tenant_id || !row.has_menu }
  // Preserve canonical complete_onboarding's role/entry-plan/repair rules.
  // It creates tenant/settings/subscription/catalog and promotes the original
  // tenant-less profile in one transaction. It makes no Source Auth call.
  const result = (await query('SELECT public.complete_onboarding($1::uuid,$2::jsonb) AS result',[userId,JSON.stringify(input)])).rows[0]?.result
  if (!result || typeof result !== 'object') throw new Error('Onboarding failed')
  return { ...result,already_configured: !!row.tenant_id } as { tenant_id: string; tenant_slug: string; menu_slug: string; created_tenant: boolean; already_configured: boolean }
}
