export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  const service = await createServiceClient()

  const [{ data: authData }, { data: profiles }, { data: tenants }] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 1000 }),
    service.from('profiles').select('id, role, tenant_id, full_name, tenants(id, name, slug)'),
    service.from('tenants').select('id, name, slug').order('name'),
  ])

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  const users = (authData?.users ?? []).map(u => {
    const profile = profileMap.get(u.id)
    return {
      id: u.id,
      email: u.email,
      full_name: profile?.full_name ?? (u.user_metadata?.full_name as string | null) ?? null,
      role: profile?.role ?? null,
      tenant_id: profile?.tenant_id ?? null,
      tenant: ((profile?.tenants as unknown as Array<{ id: string; name: string; slug: string }> | null) ?? [])[0] ?? null,
      provider: (u.app_metadata?.provider as string) ?? 'email',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }
  })

  return (
    <UsersClient
      users={users}
      tenants={tenants ?? []}
    />
  )
}
