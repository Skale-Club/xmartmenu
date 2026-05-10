import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

const BLOCKED_TENANT_SLUGS = new Set([
  'pricing', 'features', 'about', 'faq', 'blog', 'help', 'support',
  'pt', 'en', 'legal', 'privacy', 'terms', 'contact', 'careers',
])

const customDomainCache = new Map<string, { slug: string; expires: number }>()
const CACHE_TTL_MS = 60_000

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
    customDomainCache.delete(normalized)
    return null
  }

  customDomainCache.set(normalized, { slug: data.slug, expires: Date.now() + CACHE_TTL_MS })
  return data.slug
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const firstSegment = pathname.split('/')[1]

  if (firstSegment && BLOCKED_TENANT_SLUGS.has(firstSegment)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase()

  if (host) {
    const tenantSlug = await resolveTenantSlugFromHost(host)
    if (tenantSlug) {
      const url = request.nextUrl.clone()
      if (!pathname.startsWith(`/${tenantSlug}`)) {
        url.pathname = `/${tenantSlug}${pathname === '/' ? '' : pathname}`
        return NextResponse.rewrite(url)
      }
    }
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
