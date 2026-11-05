import type { AdminMenuQuery } from './admin-menus'

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Lower-cased hostname without port, or null when it cannot be a verified custom domain. */
export function normalizeCustomDomainHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const host = value.split(':')[0].trim().toLowerCase()
  return HOST.test(host) ? host : null
}

/** Exactly one active tenant with this verified domain, as the legacy `.single()` demanded. */
export async function readCustomDomainTenantSlug(query: AdminMenuQuery, host: string): Promise<string | null> {
  const normalized = normalizeCustomDomainHost(host)
  if (!normalized) return null
  const { rows } = await query(
    'SELECT slug FROM public.tenants WHERE custom_domain=$1 AND is_active=true AND custom_domain_verified=true LIMIT 2', [normalized])
  return rows.length === 1 && typeof rows[0].slug === 'string' ? rows[0].slug : null
}
