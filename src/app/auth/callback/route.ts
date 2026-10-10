import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { normalizeRole, parseSuperadminEmails } from '@/lib/auth/role-utils'
import { captureSecurityEvent } from '@/lib/observability'
import { getRequestOrigin } from '@/lib/site-url'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Use the proxy-aware public origin so OAuth redirects don't land on the
  // internal bind address (0.0.0.0:3000) when running behind Coolify/Docker.
  const origin = getRequestOrigin(request)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

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
        const userEmail = user.email?.toLowerCase() ?? ''
        const isConfiguredSuperadmin = parseSuperadminEmails().includes(userEmail)

        if (isConfiguredSuperadmin && role !== 'superadmin') {
          console.warn(`[security] superadmin auto-promotion via SUPERADMIN_EMAILS: ${userEmail}`)
          captureSecurityEvent('Superadmin auto-promotion via SUPERADMIN_EMAILS', { email: userEmail, userId: user.id, source: 'auth/callback' })
          await service.from('profiles').upsert({
            id: user.id,
            role: 'superadmin',
            full_name: user.user_metadata?.full_name ?? null,
          }, { onConflict: 'id' })
          return NextResponse.redirect(`${origin}/overview`)
        }

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
