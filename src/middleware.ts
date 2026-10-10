import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
// Zero-import module — safe for the Edge bundle. See that file for the
// invariant (no entry may have a named route) and the regression history.
import { BLOCKED_TENANT_SLUGS } from './lib/marketing/blocked-tenant-slugs'
import { resolveFeedRewritePath } from './lib/feed-route'

// Cache BOTH hits and misses. Without caching misses, every request carrying an
// unknown Host header (bots hitting the raw IP, preview hosts, misconfigured
// DNS) fires a fresh `tenants` query on the request critical path.
const customDomainCache = new Map<string, { slug: string | null; expires: number }>()
const CACHE_TTL_MS = 60_000
const CACHE_MISS_TTL_MS = 30_000

async function resolveTenantSlugFromHost(host: string): Promise<string | null> {
  const normalized = host.split(':')[0].toLowerCase()

  const platformHost = process.env.NEXT_PUBLIC_APP_URL
    ?.replace(/^https?:\/\//, '').split(':')[0]
    ?? 'xmartmenu.skale.club'

  if (normalized === platformHost) return null

  const cached = customDomainCache.get(normalized)
  if (cached && cached.expires > Date.now()) return cached.slug

  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('slug, custom_domain, custom_domain_verified')
    .eq('custom_domain', normalized)
    .eq('is_active', true)
    .eq('custom_domain_verified', true)
    .single()

  if (!data) {
    customDomainCache.set(normalized, { slug: null, expires: Date.now() + CACHE_MISS_TTL_MS })
    return null
  }

  customDomainCache.set(normalized, { slug: data.slug, expires: Date.now() + CACHE_TTL_MS })
  return data.slug
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Internal QStash worker routes authenticate by signature, not session.
  // Let /api/internal/* through untouched BEFORE any tenant-slug block,
  // custom-domain host rewrite, or updateSession()/getUser() so an
  // unauthenticated QStash POST always reaches the route handler (Pitfall 4f/10).
  if (pathname.startsWith('/api/internal/')) {
    return NextResponse.next()
  }

  // MCP server authenticates via OAuth Bearer token (not the Supabase session
  // cookie), and its OAuth metadata is a public discovery document. Both must
  // bypass updateSession()/getUser() AND the custom-domain host rewrite so the
  // endpoint resolves identically on every host and is never redirected.
  if (
    pathname.startsWith('/api/mcp') ||
    pathname.startsWith('/.well-known/oauth-protected-resource')
  ) {
    return NextResponse.next()
  }

  const firstSegment = pathname.split('/')[1]

  if (firstSegment && BLOCKED_TENANT_SLUGS.has(firstSegment)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase()

  if (host) {
    const tenantSlug = await resolveTenantSlugFromHost(host)

    const feedRewritePath = resolveFeedRewritePath(pathname, tenantSlug)
    if (feedRewritePath) {
      const url = request.nextUrl.clone()
      url.pathname = feedRewritePath
      url.searchParams.set('view', 'feed')
      return await updateSession(request, url)
    }

    if (tenantSlug && !pathname.startsWith(`/${tenantSlug}`)) {
      const url = request.nextUrl.clone()
      url.pathname = `/${tenantSlug}${pathname === '/' ? '' : pathname}`
      // Rewrite AND refresh the session in one pass. Returning a bare
      // NextResponse.rewrite() here (the old behavior) skipped updateSession, so
      // Supabase auth cookies were never refreshed on custom-domain requests and
      // customer sessions (e.g. /me) silently expired.
      return await updateSession(request, url)
    }
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
