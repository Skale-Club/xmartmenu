import { ownedAdminTransaction } from './admin-menus-runtime'
import { readOwnerAuditPage, readPlatformAuditPage, type AuditFilters } from './admin-audit'
import type { UserRole } from '@/types/database'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'
import { createClient } from '@/lib/supabase/server'
import { AdminMenuError } from './admin-menus'

/** Current authority, never a role supplied by a page or cached layout. */
export async function getPlatformAuditPrincipal() {
  if (ownedAuthSelected()) return getOwnedPrincipal()
  const source = await createClient()
  const { data: { user }, error: authError } = await source.auth.getUser()
  if (authError) throw new AdminMenuError(503, 'Authentication is unavailable')
  if (!user) return null
  const { data: profile,error } = await source.from('profiles').select('role,must_change_password').eq('id',user.id).single()
  if (error) throw new AdminMenuError(503, 'Authentication is unavailable')
  if (profile?.role !== 'superadmin') return null
  return { userId: user.id,role: profile.role as UserRole,mustChangePassword: profile.must_change_password === true }
}

export const readOwnedOwnerAuditPage = (context: { tenantId: string; role: UserRole }, filters: AuditFilters) =>
  ownedAdminTransaction(false, query => readOwnerAuditPage(query, context, filters))

export async function readOwnedPlatformAuditPage(filters: AuditFilters) {
  const principal = await getPlatformAuditPrincipal()
  if (!principal || principal.mustChangePassword || principal.role !== 'superadmin') throw new AdminMenuError(403, 'Forbidden')
  return ownedAdminTransaction(false, query => readPlatformAuditPage(query, { role: principal.role }, filters))
}
