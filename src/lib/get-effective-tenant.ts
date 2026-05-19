import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { normalizeRole } from '@/lib/auth/role-utils'
import type { UserRole } from '@/types/database'

interface EffectiveTenant {
  tenantId: string
  slug: string
  name: string
  role: UserRole
}

export async function getEffectiveTenant(): Promise<EffectiveTenant | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tenant_id, tenants(slug, name)')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  const normalizedRole = normalizeRole(profile.role)
  if (normalizedRole === 'superadmin') {
    const cookieStore = await cookies()
    const previewTenantId = cookieStore.get('preview_tenant_id')?.value
    if (!previewTenantId) return null

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, slug, name')
      .eq('id', previewTenantId)
      .single()

    if (!tenant) return null
    return { tenantId: tenant.id, slug: tenant.slug, name: tenant.name, role: 'superadmin' }
  }

  const t = profile.tenants as any
  return {
    tenantId: profile.tenant_id,
    slug: t?.slug ?? '',
    name: t?.name ?? '',
    role: (normalizedRole ?? profile.role) as UserRole,
  }
}
