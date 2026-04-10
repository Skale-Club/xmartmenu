export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import TenantsClient from './TenantsClient'

export default async function TenantsPage() {
  const service = await createServiceClient()

  const [{ data: tenants }, { data: authData }, { data: profiles }] = await Promise.all([
    service.from('tenants').select('id, name, slug, plan, is_active, created_at, tenant_settings(logo_url)').order('created_at', { ascending: false }),
    service.auth.admin.listUsers({ perPage: 1000 }),
    service.from('profiles').select('id, role, tenant_id, full_name'),
  ])

  const authMap = new Map((authData?.users ?? []).map(u => [u.id, u]))

  // Monta lista combinada: cada cliente = tenant + seu usuário admin
  const clients = (tenants ?? []).map(tenant => {
    const profile = (profiles ?? []).find(p => p.tenant_id === tenant.id && p.role === 'admin')
    const authUser = profile ? authMap.get(profile.id) : null
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      is_active: tenant.is_active,
      created_at: tenant.created_at,
      logo_url: ((tenant.tenant_settings as unknown as Array<{ logo_url: string | null }> | null)?.[0]?.logo_url) ?? null,
      // dados do usuário
      user_id: profile?.id ?? null,
      email: authUser?.email ?? null,
      full_name: profile?.full_name ?? null,
      provider: (authUser?.app_metadata?.provider as string) ?? 'email',
    }
  })

  // Usuários sem tenant (ex: Google login sem atribuição)
  const unassigned = (authData?.users ?? [])
    .filter(u => {
      const profile = (profiles ?? []).find(p => p.id === u.id)
      return !profile?.tenant_id && profile?.role !== 'superadmin'
    })
    .map(u => ({
      id: null,
      name: null,
      slug: null,
      plan: null,
      is_active: null,
      created_at: u.created_at,
      logo_url: null,
      user_id: u.id,
      email: u.email ?? null,
      full_name: (u.user_metadata?.full_name as string) ?? null,
      provider: (u.app_metadata?.provider as string) ?? 'email',
    }))

  return <TenantsClient clients={[...clients, ...unassigned]} />
}
