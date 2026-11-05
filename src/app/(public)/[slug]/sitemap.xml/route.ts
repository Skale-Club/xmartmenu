import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCanonicalUrl } from '@/lib/seo'
import { ownedModeActive } from '@/lib/data/owned-mode'

export const revalidate = 300

function xmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function urlEntry(loc: string, lastmod?: string, priority = '0.8') {
  return `<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>${priority}</priority></url>`
}

function urlset(entries: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  if (ownedModeActive()) {
    // Own PostgreSQL only; an outage is a 503, never a read of the stale copy.
    try {
      const { ownedTenantSitemap } = await import('@/lib/data/public-seo-runtime')
      const found = await ownedTenantSitemap(slug)
      if (!found) return new NextResponse('Not found', { status: 404 })
      const { tenant, menus, locations } = found
      const owned = [urlEntry(getCanonicalUrl(tenant, '/'), tenant.updated_at?.slice(0, 10), '1.0')]
      for (const menu of menus) if (!menu.is_default) owned.push(urlEntry(getCanonicalUrl(tenant, `/${menu.slug}`), menu.updated_at?.slice(0, 10)))
      for (const loc of locations) owned.push(urlEntry(getCanonicalUrl(tenant, `/${loc.slug}`), loc.updated_at?.slice(0, 10)))
      return new NextResponse(urlset(owned), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
    } catch { return new NextResponse('Service unavailable', { status: 503 }) }
  }
  const supabase = createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, custom_domain, custom_domain_verified, updated_at')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!tenant) {
    return new NextResponse('Not found', { status: 404 })
  }

  const [{ data: menus }, { data: locations }] = await Promise.all([
    supabase
      .from('menus')
      .select('slug, is_default, updated_at')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('position'),
    supabase
      .from('locations')
      .select('slug, updated_at')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ])

  const rootUrl = getCanonicalUrl(tenant, '/')
  const entries: string[] = [urlEntry(rootUrl, tenant.updated_at?.slice(0, 10), '1.0')]

  for (const menu of menus ?? []) {
    if (menu.is_default) continue
    const url = getCanonicalUrl(tenant, `/${menu.slug}`)
    entries.push(urlEntry(url, menu.updated_at?.slice(0, 10)))
  }

  for (const loc of locations ?? []) {
    const url = getCanonicalUrl(tenant, `/${loc.slug}`)
    entries.push(urlEntry(url, loc.updated_at?.slice(0, 10)))
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
