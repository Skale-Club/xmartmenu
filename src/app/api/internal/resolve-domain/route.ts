import { NextResponse } from 'next/server'
import { ownedModeActive } from '@/lib/data/owned-mode'
import { isLoopbackCall, normalizeCustomDomainHost, readHostTenantSlug } from '@/lib/data/tenant-domain'
import { subdomainBase } from '@/lib/tenant-subdomain'

// Used only by the Edge middleware in owned mode (pg cannot run there). It
// answers a public fact: which verified custom domain or restaurant subdomain
// (<label>.<TENANT_SUBDOMAIN_BASE>) belongs to which slug.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!ownedModeActive() || !isLoopbackCall(request.headers)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
  const host = normalizeCustomDomainHost(new URL(request.url).searchParams.get('host'))
  if (!host) return NextResponse.json({ slug: null }, { headers })
  try {
    const { ownedAdminTransaction } = await import('@/lib/data/admin-menus-runtime')
    return NextResponse.json({ slug: await ownedAdminTransaction(false, query => readHostTenantSlug(query, host, subdomainBase()), 3000) }, { headers })
  } catch {
    return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers })
  }
}
