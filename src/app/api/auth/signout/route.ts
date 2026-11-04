import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ownedAuthSelected, ownedSessionToken } from '@/lib/auth/owned-principal'
import { getIdentityServices } from '@/lib/auth/identity-services'

// P1-07 fix: signout is a POST endpoint so link-previews, prefetches, and
// cross-origin <img>/<iframe> loads cannot trigger a logout. The superadmin
// layout uses a <form method="post"> to drive this.
export async function POST(request: Request) {
  if (ownedAuthSelected()) {
    try {
      const { config, store } = getIdentityServices(), origin = new URL(config.origin)
      if (request.headers.get('origin') !== origin.origin || request.headers.get('host')?.toLowerCase() !== origin.host.toLowerCase()
        || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 })
      const secure = origin.protocol === 'https:', token = ownedSessionToken(request.headers.get('cookie'), secure)
      if (token) await store.logout(token)
      const response = NextResponse.redirect(new URL('/auth/login', origin), { status: 303 })
      for (const name of [`${secure ? '__Host-' : ''}xm_identity`, `${secure ? '__Host-' : ''}xm_identity_challenge`]) {
        response.cookies.set(name, '', { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 0 })
      }
      response.cookies.delete('preview_tenant_id'); response.cookies.delete('selected_menu_id')
      return response
    } catch { return NextResponse.json({ error: 'Sign out is temporarily unavailable' }, { status: 503 }) }
  }
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(
    new URL('/auth/login', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    { status: 303 },
  )
}
