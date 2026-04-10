import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function assertSuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'superadmin' ? true : null
}

export async function GET() {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  const { data: authUsers } = await service.auth.admin.listUsers({ perPage: 1000 })
  const { data: profiles } = await service.from('profiles').select('id, role, tenant_id, full_name, tenants(id, name, slug)')

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  const users = (authUsers?.users ?? []).map(u => {
    const profile = profileMap.get(u.id)
    return {
      id: u.id,
      email: u.email,
      full_name: profile?.full_name ?? u.user_metadata?.full_name ?? null,
      role: profile?.role ?? null,
      tenant_id: profile?.tenant_id ?? null,
      tenant: (Array.isArray(profile?.tenants)
        ? profile.tenants[0] ?? null
        : profile?.tenants ?? null) as { id: string; name: string; slug: string } | null,
      provider: u.app_metadata?.provider ?? 'email',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }
  })

  return NextResponse.json(users)
}
