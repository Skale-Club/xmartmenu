import type { UserRole } from '@/types/database'

export function parseSuperadminEmails() {
  return (process.env.SUPERADMIN_EMAILS ?? '')
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function normalizeRole(role: unknown): UserRole | null {
  if (role === 'superadmin' || role === 'store-admin' || role === 'store-staff' || role === 'customer') {
    return role
  }
  if (role === 'super-admin') return 'superadmin'
  if (role === 'admin') return 'store-admin'
  return null
}

/** Roles that work inside a restaurant's back office. Customers never do. */
export function isTenantMemberRole(role: UserRole | null): role is 'store-admin' | 'store-staff' {
  return role === 'store-admin' || role === 'store-staff'
}

/**
 * May change the restaurant's catalog, settings and staff. An allowlist on
 * purpose: a new or unknown role gets nothing until it is added here (and to
 * public.auth_can_manage_tenant in the database).
 */
export function canManageTenant(role: UserRole | null): boolean {
  return role === 'store-admin' || role === 'superadmin'
}
