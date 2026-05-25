export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { computePrimaryForeground } from '@/lib/color-utils'

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
    // Avoid infinite loop: sign out before redirecting
    await supabase.auth.signOut()
    redirect('/auth/login')
  }

  // Superadmin can access any tenant's panel via preview cookie
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
        .select('ingredient_customization_enabled, primary_color, accent_color')
        .eq('tenant_id', tenant.id)
        .single(),
    ])

    const previewPrimary = (tenantSettings as any)?.primary_color ?? '#F52323'
    const previewAccent = (tenantSettings as any)?.accent_color ?? '#09090b'
    const previewPrimaryFg = computePrimaryForeground(previewPrimary)

    return (
      <>
      <style>{`:root{--primary:${previewPrimary};--primary-foreground:${previewPrimaryFg};--accent:${previewAccent};}`}</style>
      <div className="flex h-screen bg-zinc-950">
        <div className="flex flex-col w-64 flex-shrink-0 border-r border-zinc-800">
          <div className="bg-primary text-primary-foreground text-[10px] py-2 font-black uppercase tracking-widest flex items-center justify-center gap-2">
            <span>Viewing: {tenant.name}</span>
            <a href="/api/admin/exit-preview" className="px-2 py-0.5 rounded-sm bg-zinc-950 text-white text-[9px] hover:bg-zinc-800 transition-colors no-underline">Exit</a>
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
         <main className="flex-1 overflow-y-auto bg-zinc-100">{children}</main>
      </div>
      </>
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
      .select('ingredient_customization_enabled, primary_color, accent_color')
      .eq('tenant_id', tenantId)
      .single(),
  ])

  const adminPrimary = (tenantSettings as any)?.primary_color ?? '#F52323'
  const adminAccent = (tenantSettings as any)?.accent_color ?? '#09090b'
  const adminPrimaryFg = computePrimaryForeground(adminPrimary)

  return (
    <>
    <style>{`:root{--primary:${adminPrimary};--primary-foreground:${adminPrimaryFg};--accent:${adminAccent};}`}</style>
    <div className="flex h-screen bg-zinc-950">
      <AdminSidebar
        tenantName={profile.tenants?.name ?? 'My Restaurant'}
        tenantSlug={(profile.tenants as any)?.slug}
        role={profile.role}
        appName={appName}
        menus={menus ?? []}
        activeMenuId={activeMenu?.id ?? null}
        ingredientCustomizationEnabled={tenantSettings?.ingredient_customization_enabled ?? false}
      />
       <main className="flex-1 overflow-y-auto bg-zinc-100">
         {children}
       </main>
    </div>
    </>
  )
}
