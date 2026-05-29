import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCanonicalUrl, PLATFORM_HOST } from '@/lib/seo'

export const revalidate = 300

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('slug, custom_domain, custom_domain_verified')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  // The middleware rewrites `customdomain.com/robots.txt` to this very route, so
  // we must look at the *real* request host to decide indexing — otherwise the
  // custom domain would serve its own `Disallow: /` and de-index the restaurant.
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase() ?? PLATFORM_HOST
  const hasCustomDomain = !!(tenant?.custom_domain && tenant?.custom_domain_verified)
  const servedOnCustomDomain = hasCustomDomain && host === tenant!.custom_domain

  // Block indexing of the platform-slug copy only when a verified custom domain
  // is the canonical home. The custom domain itself (and slug-only tenants) index freely.
  const blockIndexing = hasCustomDomain && !servedOnCustomDomain

  const sitemapUrl = getCanonicalUrl(tenant!, '/sitemap.xml')
  const body = blockIndexing
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`

  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
