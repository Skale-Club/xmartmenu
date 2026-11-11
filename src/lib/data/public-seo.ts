import type { AdminMenuQuery } from './admin-menus'
import { parseTags, tagSlug } from '../blog/public-queries'

const iso = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  return typeof value === 'string' ? value : null
}
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/i

export interface SeoTenant { id: string; slug: string; custom_domain: string | null; custom_domain_verified: boolean; subdomain: string | null; updated_at: string | null }
// tenants.subdomain through to_jsonb(t): null until the schema step adds it.
const SUBDOMAIN = `to_jsonb(t)->>'subdomain' AS subdomain`
const label = (value: unknown) => (typeof value === 'string' && value ? value : null)

export async function readSitemapTenants(query: AdminMenuQuery) {
  const { rows } = await query(`SELECT t.slug, t.updated_at, t.custom_domain, t.custom_domain_verified, ${SUBDOMAIN} FROM public.tenants t WHERE t.is_active=true ORDER BY t.updated_at DESC LIMIT 5000`)
  return rows.map(row => ({ slug: String(row.slug), updated_at: iso(row.updated_at), custom_domain: (row.custom_domain as string | null) ?? null, custom_domain_verified: row.custom_domain_verified === true, subdomain: label(row.subdomain) }))
}

/** Platform blog (tenant_id IS NULL) only; posts, tags and archive come from one bounded read. */
export async function readPlatformBlogSitemap(query: AdminMenuQuery, now = new Date()) {
  const { rows } = await query(`SELECT slug, tags, published_at, updated_at FROM public.blog_posts
    WHERE tenant_id IS NULL AND status='published' ORDER BY published_at DESC NULLS LAST LIMIT 5000`)
  const posts = rows.slice(0, 1000).map(row => ({ slug: String(row.slug), published_at: iso(row.published_at), updated_at: iso(row.updated_at) }))
  const live = rows.filter(row => row.published_at instanceof Date && row.published_at.getTime() <= now.getTime())
  const tags = new Set<string>(), archive = new Map<string, { year: number; month: number }>()
  for (const row of live) {
    for (const tag of parseTags(row.tags as string | null)) { const slug = tagSlug(tag); if (slug) tags.add(slug) }
    const date = row.published_at as Date
    archive.set(`${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`, { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 })
  }
  return { posts, tags: [...tags], archive: [...archive.values()].sort((a, b) => b.year - a.year || b.month - a.month) }
}

export async function readSeoTenant(query: AdminMenuQuery, slug: string): Promise<SeoTenant | null> {
  if (!SLUG.test(slug)) return null
  const { rows } = await query(`SELECT t.id, t.slug, t.custom_domain, t.custom_domain_verified, ${SUBDOMAIN}, t.updated_at FROM public.tenants t WHERE t.slug=$1 AND t.is_active=true LIMIT 2`, [slug])
  if (rows.length !== 1) return null
  const row = rows[0]
  return { id: String(row.id), slug: String(row.slug), custom_domain: (row.custom_domain as string | null) ?? null,
    custom_domain_verified: row.custom_domain_verified === true, subdomain: label(row.subdomain), updated_at: iso(row.updated_at) }
}

export async function readTenantSitemapEntries(query: AdminMenuQuery, tenantId: string) {
  const [menus, locations] = await Promise.all([
    query('SELECT slug, is_default, updated_at FROM public.menus WHERE tenant_id=$1 AND is_active=true ORDER BY position, id LIMIT 1000', [tenantId]),
    query('SELECT slug, updated_at FROM public.locations WHERE tenant_id=$1 AND is_active=true ORDER BY created_at ASC, id LIMIT 1000', [tenantId]),
  ])
  return {
    menus: menus.rows.map(row => ({ slug: String(row.slug), is_default: row.is_default === true, updated_at: iso(row.updated_at) })),
    locations: locations.rows.map(row => ({ slug: String(row.slug), updated_at: iso(row.updated_at) })),
  }
}

export async function readOgTenant(query: AdminMenuQuery, slug: string) {
  if (!SLUG.test(slug)) return null
  const { rows } = await query(`SELECT t.name, s.primary_color, s.accent_color, s.tagline, s.logo_url FROM public.tenants t
    LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.slug=$1 AND t.is_active=true LIMIT 2`, [slug])
  if (rows.length !== 1) return null
  const r = rows[0]
  const text = (v: unknown) => (typeof v === 'string' ? v : null)
  return { name: String(r.name), settings: { primary_color: text(r.primary_color) ?? undefined, accent_color: text(r.accent_color) ?? undefined, tagline: text(r.tagline), logo_url: text(r.logo_url) } }
}
