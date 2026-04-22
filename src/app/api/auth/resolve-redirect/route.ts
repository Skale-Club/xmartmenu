import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeRole, parseSuperadminEmails } from '@/lib/auth/role-utils'

function getSafeNext(value: unknown) {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const next = getSafeNext(body?.next)

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ redirectTo: '/auth/login' }, { status: 401 })
    }

    const service = createServiceClient()
    const { data: profile } = await service
      .from('profiles')
      .select('role, tenant_id, must_change_password')
      .eq('id', user.id)
      .single()

    const role = normalizeRole(profile?.role)
    const userEmail = user.email?.toLowerCase() ?? ''
    const isConfiguredSuperadmin = parseSuperadminEmails().includes(userEmail)

    if (isConfiguredSuperadmin && role !== 'superadmin') {
      await service.from('profiles').upsert(
        {
          id: user.id,
          role: 'superadmin',
          full_name: user.user_metadata?.full_name ?? null,
        },
        { onConflict: 'id' }
      )
      return NextResponse.json({ redirectTo: '/overview' })
    }

    if (role === 'superadmin') {
      return NextResponse.json({ redirectTo: '/overview' })
    }

    if (role === 'customer') {
      return NextResponse.json({ redirectTo: next })
    }

    if (profile?.must_change_password) {
      return NextResponse.json({ redirectTo: '/settings/password?forced=1' })
    }

    if (!profile || !role) {
      return NextResponse.json({ redirectTo: '/dashboard' })
    }

    if (role === 'store-admin' && !profile.tenant_id) {
      return NextResponse.json({ redirectTo: '/onboarding' })
    }

    if (!profile.tenant_id) {
      return NextResponse.json({ redirectTo: '/dashboard' })
    }

    return NextResponse.json({ redirectTo: '/dashboard' })
  } catch {
    return NextResponse.json({ redirectTo: '/auth/login?error=auth_failed' }, { status: 500 })
  }
}
