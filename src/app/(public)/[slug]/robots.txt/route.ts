import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCanonicalUrl, PLATFORM_HOST, tenantOwnHost, type CanonicalTenant } from '@/lib/seo'
import { ownedModeActive } from '@/lib/data/owned-mode'

export const revalidate = 300

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  let tenant: CanonicalTenant | null
  if (ownedModeActive()) {
    // Own PostgreSQL only. On failure answer 503 so crawlers retry, rather than
    // caching a wrong "Disallow" or reading the stale Supabase copy.
    try {
      const { ownedRobotsTenant } = await import('@/lib/data/public-seo-runtime')
      tenant = await ownedRobotsTenant(slug)
    } catch { return new NextResponse('Service unavailable', { status: 503 }) }
  } else {
    const supabase = createServiceClient()
    tenant = (await supabase
      .from('tenants')
      .select('slug, custom_domain, custom_domain_verified')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()).data
  }

  // The middleware rewrites `customdomain.com/robots.txt` to this very route, so
  // we must look at the *real* request host to decide indexing — otherwise the
  // custom domain would serve its own `Disallow: /` and de-index the restaurant.
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase() ?? PLATFORM_HOST
  // The restaurant's own host: a verified custom domain, else its subdomain.
  const ownHost = tenant ? tenantOwnHost(tenant) : null

  // Block indexing on any host other than the restaurant's own (custom domain,
  // else subdomain) when it has one. That host itself (and slug-only tenants) index freely.
  const blockIndexing = !!ownHost && host !== ownHost

  const sitemapUrl = getCanonicalUrl(tenant!, '/sitemap.xml')
  const body = blockIndexing
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`

  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
