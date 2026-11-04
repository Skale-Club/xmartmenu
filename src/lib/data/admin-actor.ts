import { normalizeRole } from '../auth/role-utils'
import type { UserRole } from '@/types/database'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'

export interface AdminActorContext { actorId: string; role: UserRole; tenantId?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** A verified request principal is required; stored roles/controls stay current. */
export async function authorizeAdminActor(query: AdminMenuQuery, context: AdminActorContext, write = false) {
  if (!UUID.test(context.actorId) || (context.tenantId !== undefined && !UUID.test(context.tenantId)) || !['store-admin', 'superadmin'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')
  const result = await query(`SELECT p.id,p.role,p.tenant_id,p.must_change_password,a.disabled_at FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id WHERE p.id=$1${write ? ' FOR SHARE OF p,a' : ''}`, [context.actorId])
  const profile = result.rows[0], role = normalizeRole(profile?.role)
  if (result.rows.length !== 1 || !profile || profile.disabled_at !== null || profile.must_change_password === true || role !== context.role
    || (role !== 'superadmin' && (!context.tenantId || profile.tenant_id !== context.tenantId))) throw new AdminMenuError(403, 'Forbidden')
}
