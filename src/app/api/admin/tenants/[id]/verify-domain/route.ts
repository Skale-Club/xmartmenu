import { NextResponse } from 'next/server'
import dns from 'dns'

export async function POST(
  request: Request,
  _context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const body = await request.json()
  const { custom_domain } = body

  if (!custom_domain || typeof custom_domain !== 'string') {
    return NextResponse.json({ error: 'custom_domain required' }, { status: 400 })
  }

  const normalizedDomain = custom_domain.trim().toLowerCase()

  const platformHost = process.env.NEXT_PUBLIC_APP_URL
    ?.replace(/^https?:\/\//, '').split(':')[0]
    ?? 'xmartmenu.skale.club'

  return new Promise<Response>((resolve) => {
    dns.lookup(normalizedDomain, (err, address) => {
      if (err || !address) {
        resolve(NextResponse.json({ verified: false, domain: normalizedDomain, reason: 'DNS lookup failed' }))
        return
      }
      dns.lookup(platformHost, (err2, platformAddr) => {
        if (err2 || !platformAddr) {
          resolve(NextResponse.json({ verified: false, domain: normalizedDomain, reason: 'Platform host lookup failed' }))
          return
        }
        const verified = address === platformAddr
        resolve(NextResponse.json({ verified, domain: normalizedDomain, reason: verified ? 'OK' : 'IP mismatch' }))
      })
    })
  })
}
