export const dynamic = 'force-dynamic'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listAllAuthUsers } from '@/lib/admin/list-auth-users'
import UsersClient from './UsersClient'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { accountAdministrationSelected } from '@/lib/data/account-administration'
import { readOwnedAccountUsersPage } from '@/lib/data/account-administration-runtime'
import type { UserRow,TenantOption } from './UsersClient'

export default async function UsersPage() {
  if (ownedAuthSelected() || accountAdministrationSelected()) {
    const data = await readOwnedAccountUsersPage()
    return <UsersClient native users={data.users as unknown as UserRow[]} tenants={data.tenants as unknown as TenantOption[]} currentUserId={data.currentUserId} />
  }
  const service = await createServiceClient()
  const supabase = await createClient()

  const [{ data: { user: currentUser } }, authUsers, { data: profiles }, { data: tenants }] = await Promise.all([
    supabase.auth.getUser(),
    listAllAuthUsers(service),
    service.from('profiles').select('id, role, tenant_id, full_name, tenants(id, name, slug)'),
    service.from('tenants').select('id, name, slug').order('name'),
  ])

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  const users = authUsers.map(u => {
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
      currentUserId={currentUser?.id ?? null}
    />
  )
}
