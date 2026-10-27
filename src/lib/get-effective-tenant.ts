import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isTenantMemberRole, normalizeRole } from '@/lib/auth/role-utils'
import type { UserRole } from '@/types/database'
import { setRequestContext } from '@/lib/observability/context'

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
    // Logs, Sentry and the audit trail attribute this request to the superadmin.
    setRequestContext({ actorId: user.id, tenantId: tenant.id, tenantSlug: tenant.slug, role: 'superadmin' })
    return { tenantId: tenant.id, slug: tenant.slug, name: tenant.name, role: 'superadmin' }
  }

  // Callers deny `store-staff` and let every other role through, so anything
  // that is not a back-office role of a real restaurant (a customer, an unknown
  // role, a profile without a tenant) must stop here.
  if (!isTenantMemberRole(normalizedRole) || !profile.tenant_id) return null

  const t = profile.tenants as any
  setRequestContext({ actorId: user.id, tenantId: profile.tenant_id, tenantSlug: t?.slug ?? undefined, role: normalizedRole })
  return {
    tenantId: profile.tenant_id,
    slug: t?.slug ?? '',
    name: t?.name ?? '',
    role: normalizedRole,
  }
}
