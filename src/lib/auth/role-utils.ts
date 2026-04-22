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
