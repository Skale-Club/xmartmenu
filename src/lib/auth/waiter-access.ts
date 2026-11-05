import { normalizeRole } from './role-utils'

/** Same rule for the legacy profile and the native principal: superadmin, or store staff of this tenant. */
export function waiterAccess(actor: { role: unknown; tenantId: string | null } | null, tenantId: string): boolean {
  if (!actor) return false
  const role = normalizeRole(actor.role)
  if (role === 'superadmin') return true
  return (role === 'store-admin' || role === 'store-staff') && actor.tenantId === tenantId
}
