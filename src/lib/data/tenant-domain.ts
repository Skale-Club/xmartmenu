import type { AdminMenuQuery } from './admin-menus'
import { subdomainLabelFromHost } from '../tenant-subdomain'

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

/** Whether tenants.subdomain exists yet (docs/owned-schema/20261111140000_tenant_subdomain.sql). */
export async function subdomainColumnReady(query: AdminMenuQuery): Promise<boolean> {
  const { rows } = await query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tenants' AND column_name='subdomain') AS ready`)
  return rows[0]?.ready === true
}

/**
 * The restaurant a request host belongs to: <label>.<subdomain base> by
 * tenants.subdomain, otherwise a verified custom domain. Null when neither.
 */
export async function readHostTenantSlug(query: AdminMenuQuery, host: string, base: string | null): Promise<string | null> {
  const label = subdomainLabelFromHost(host, base)
  if (!label) return readCustomDomainTenantSlug(query, host)
  if (!await subdomainColumnReady(query)) return null
  const { rows } = await query('SELECT slug FROM public.tenants WHERE subdomain=$1 AND is_active=true LIMIT 2', [label])
  return rows.length === 1 && typeof rows[0].slug === 'string' ? rows[0].slug : null
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Only the middleware's own loopback call: a proxied request carries x-forwarded-for and a public Host. */
export function isLoopbackCall(headers: Headers): boolean {
  if (headers.get('x-forwarded-for') !== null) return false
  const host = (headers.get('host') ?? '').toLowerCase().replace(/:\d{1,5}$/, '')
  return LOOPBACK_HOSTS.has(host)
}
