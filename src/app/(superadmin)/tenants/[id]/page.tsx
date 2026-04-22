export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import TenantDetailClient from './TenantDetailClient'

interface Props { params: Promise<{ id: string }> }

export default async function TenantDetailPage({ params }: Props) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'superadmin') redirect('/dashboard')

  const service = await createServiceClient()

  const { data: tenant } = await service
    .from('tenants')
    .select('id, name, slug, plan, is_active, created_at')
    .eq('id', id)
    .single()

  if (!tenant) notFound()

  const { data: settings } = await service
    .from('tenant_settings')
    .select('logo_url')
    .eq('tenant_id', id)
    .single()

  const { data: staffRows } = await service
    .from('profiles')
    .select('id, full_name, phone, created_at')
    .eq('tenant_id', id)
    .eq('role', 'store-staff')
    .order('created_at', { ascending: false })

  const staffWithEmail = await Promise.all(
    (staffRows ?? []).map(async (p) => {
      const { data: u } = await service.auth.admin.getUserById(p.id)
      return { ...p, email: u.user?.email ?? null }
    })
  )

  const { data: menus } = await service
    .from('menus')
    .select('id, name, slug, language, is_active, position, created_at')
    .eq('tenant_id', id)
    .order('position')

  return (
    <TenantDetailClient
      tenant={{ ...tenant, logo_url: settings?.logo_url ?? null }}
      initialStaff={staffWithEmail}
      initialMenus={menus ?? []}
    />
  )
}
