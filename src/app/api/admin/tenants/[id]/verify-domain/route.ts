import { NextResponse } from 'next/server'
import dns from 'dns'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'

const dnsLookup = (host: string) =>
  new Promise<string | null>((resolve) => {
    dns.lookup(host, (err, address) => resolve(err || !address ? null : address))
  })

const dnsResolveCname = (host: string) =>
  new Promise<string[]>((resolve) => {
    dns.resolveCname(host, (err, addresses) => resolve(err || !addresses ? [] : addresses))
  })

const dnsResolve4 = (host: string) =>
  new Promise<string[]>((resolve) => {
    dns.resolve4(host, (err, addresses) => resolve(err || !addresses ? [] : addresses))
  })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Auth: only the tenant owner (or a superadmin in preview mode) may verify.
  const effective = await getEffectiveTenant()
  if (!effective) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (effective.tenantId !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { custom_domain } = body as { custom_domain?: string }

  if (!custom_domain || typeof custom_domain !== 'string') {
    return NextResponse.json({ error: 'custom_domain required' }, { status: 400 })
  }

  const normalizedDomain = custom_domain.trim().toLowerCase()
  const platformHost = (process.env.NEXT_PUBLIC_APP_URL
    ?.replace(/^https?:\/\//, '')
    .split(':')[0]) ?? 'xmartmenu.skale.club'

  // Strategy: accept either a CNAME pointing at the platform host, or one of
  // the A records matching one of the platform's A records (Vercel rotates
  // IPs, so a single-IP equality check is too brittle).
  const cnames = await dnsResolveCname(normalizedDomain)
  const cnameMatches = cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === platformHost)

  let aMatches = false
  if (!cnameMatches) {
    const [domainAs, platformAs] = await Promise.all([
      dnsResolve4(normalizedDomain),
      dnsResolve4(platformHost),
    ])
    const platformSet = new Set(platformAs)
    aMatches = domainAs.some((ip) => platformSet.has(ip))

    // Fallback: simple lookup (handles platforms that don't return A records)
    if (!aMatches) {
      const [domainLookup, platformLookup] = await Promise.all([
        dnsLookup(normalizedDomain),
        dnsLookup(platformHost),
      ])
      aMatches = !!domainLookup && !!platformLookup && domainLookup === platformLookup
    }
  }

  const verified = cnameMatches || aMatches

  // Persist verification flag when verification passes
  if (verified) {
    const service = await createServiceClient()
    await service
      .from('tenants')
      .update({ custom_domain_verified: true, custom_domain: normalizedDomain })
      .eq('id', id)
  }

  return NextResponse.json({
    verified,
    domain: normalizedDomain,
    reason: verified
      ? cnameMatches ? 'CNAME matches platform host' : 'A record matches platform'
      : 'No CNAME or A record matches platform',
  })
}
