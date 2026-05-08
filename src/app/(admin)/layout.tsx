export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const service = await createServiceClient()
  const { data: platformSettings } = await service.from('platform_settings').select('app_name').single()
  const appName = platformSettings?.app_name ?? 'XmartMenu'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, tenants(*)')
    .eq('id', user.id)
    .single()

  if (!profile) {
    // Evita loop infinito: faz logout antes de redirecionar
    await supabase.auth.signOut()
    redirect('/auth/login')
  }

  // Superadmin pode acessar o painel de qualquer tenant via cookie
  if (profile.role === 'superadmin') {
    const cookieStore = await cookies()
    const previewTenantId = cookieStore.get('preview_tenant_id')?.value

    if (!previewTenantId) redirect('/overview')

    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', previewTenantId)
      .single()

    if (!tenant) redirect('/tenants')

    const [{ data: menus }, activeMenu, { data: tenantSettings }] = await Promise.all([
      supabase
        .from('menus')
        .select('id, name, slug, is_active, is_default')
        .eq('tenant_id', tenant.id)
        .order('position'),
      getActiveMenuForTenant(tenant.id),
      supabase
        .from('tenant_settings')
        .select('ingredient_customization_enabled')
        .eq('tenant_id', tenant.id)
        .single(),
    ])

    return (
      <div className="flex h-screen bg-zinc-50">
        <div className="flex flex-col w-60 flex-shrink-0">
          <div className="bg-amber-500 text-white text-xs text-center py-1.5 font-medium">
            Viewing: {tenant.name}
            <a href="/api/admin/exit-preview" className="ml-2 underline">Exit</a>
          </div>
          <div className="flex-1">
            <AdminSidebar
              tenantName={tenant.name}
              tenantSlug={tenant.slug}
              role="superadmin"
              appName={appName}
              menus={menus ?? []}
              activeMenuId={activeMenu?.id ?? null}
              ingredientCustomizationEnabled={tenantSettings?.ingredient_customization_enabled ?? false}
            />
          </div>
        </div>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    )
  }

  const tenantId = profile.tenant_id as string
  const [{ data: menus }, activeMenu, { data: tenantSettings }] = await Promise.all([
    supabase
      .from('menus')
      .select('id, name, slug, is_active, is_default')
      .eq('tenant_id', tenantId)
      .order('position'),
    getActiveMenuForTenant(tenantId),
    supabase
      .from('tenant_settings')
      .select('ingredient_customization_enabled')
      .eq('tenant_id', tenantId)
      .single(),
  ])

  return (
    <div className="flex h-screen bg-zinc-50">
      <AdminSidebar
        tenantName={profile.tenants?.name ?? 'My Restaurant'}
        tenantSlug={(profile.tenants as any)?.slug}
        role={profile.role}
        appName={appName}
        menus={menus ?? []}
        activeMenuId={activeMenu?.id ?? null}
        ingredientCustomizationEnabled={tenantSettings?.ingredient_customization_enabled ?? false}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
