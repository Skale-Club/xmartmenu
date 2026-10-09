import { RESERVED_PATHS } from '../marketing/reserved-paths'
import { slugify } from '../utils'

interface AssignmentProfile {
  tenant_id: string | null
  role: string | null
}

export function isPendingTenantAssignment(profile: AssignmentProfile | undefined): boolean {
  if (profile?.tenant_id) return false
  return profile?.role !== 'superadmin' && profile?.role !== 'super-admin' && profile?.role !== 'customer'
}

export function validateTenantSlug(value: unknown):
  | { ok: true; slug: string }
  | { ok: false; error: string } {
  const slug = slugify(typeof value === 'string' ? value.trim() : '')
  if (!slug) return { ok: false, error: 'Enter a valid restaurant URL.' }
  if (RESERVED_PATHS.has(slug)) {
    return { ok: false, error: 'This URL is reserved. Choose a different restaurant URL.' }
  }
  return { ok: true, slug }
}

export function getSafePreviewDestination(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/dashboard'
  return value
}
