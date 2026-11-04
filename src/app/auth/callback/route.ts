import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { normalizeRole } from '@/lib/auth/role-utils'
import { getRequestOrigin } from '@/lib/site-url'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Use the proxy-aware public origin so OAuth redirects don't land on the
  // internal bind address (0.0.0.0:3000) when running behind Coolify/Docker.
  const origin = getRequestOrigin(request)
  const code = searchParams.get('code')
  // Only a same-site path: "@evil.com" or "//evil.com" appended to the origin
  // would send the freshly signed-in user to another host.
  const rawNext = searchParams.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/\\') ? rawNext : '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const service = await createServiceClient()
        const { data: profile } = await service
          .from('profiles')
          .select('role, tenant_id, must_change_password')
          .eq('id', user.id)
          .single()

        const role = normalizeRole(profile?.role)
        if (role === 'superadmin') {
          return NextResponse.redirect(`${origin}/overview`)
        }

        if (role === 'customer') {
          return NextResponse.redirect(`${origin}${next}`)
        }

        if (profile?.must_change_password) {
          return NextResponse.redirect(`${origin}/settings/password?forced=1`)
        }

        if (!profile || !role) {
          return NextResponse.redirect(`${origin}/dashboard`)
        }

        // Store-admin sem tenant deve passar no onboarding.
        if (role === 'store-admin' && !profile.tenant_id) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }

        if (!profile.tenant_id) {
          return NextResponse.redirect(`${origin}/dashboard`)
        }

        return NextResponse.redirect(`${origin}/dashboard`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
}
