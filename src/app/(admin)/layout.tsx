export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import DashboardShell from '@/components/admin/DashboardShell'
import DemoBanner from '@/components/demo/DemoBanner'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import { ArrowLeft } from 'lucide-react'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const service = await createServiceClient()
  const { data: platformSettings } = await service.from('platform_settings').select('app_name, favicon_url').single()
  const appName = platformSettings?.app_name ?? 'XmartMenu'
  const logoUrl = platformSettings?.favicon_url ?? null

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
    const exitPreviewHref = `/api/admin/exit-preview?next=${encodeURIComponent(`/tenants/${tenant.id}`)}`

    return (
      <>
      <style>{`:root{--primary:${safeCssColor(previewPrimary)};--primary-foreground:${previewPrimaryFg};--accent:${safeCssColor(previewAccent)};}`}</style>
      <DashboardShell
        appName={appName}
        contextName={tenant.name}
        eyebrow="Preview mode"
        logoUrl={logoUrl}
        headerAction={(
          <a
            href={exitPreviewHref}
            aria-label={`Return to ${tenant.name} management`}
            className="flex min-h-10 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-xs font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96"
          >
            <ArrowLeft className="size-4" />
            Back
          </a>
        )}
        sidebar={(
        <div className="flex h-full flex-col bg-zinc-950">
          <div className="bg-primary text-primary-foreground text-[10px] py-2 font-black uppercase tracking-widest flex items-center justify-center gap-2">
            <span>Viewing: {tenant.name}</span>
            <a href={exitPreviewHref} className="flex min-h-8 items-center rounded-lg bg-zinc-950 px-3 text-[9px] text-white no-underline transition-colors hover:bg-zinc-800">Exit preview</a>
          </div>
          <div className="min-h-0 flex-1">
            <AdminSidebar
              tenantName={tenant.name}
              tenantSlug={tenant.slug}
              role="superadmin"
              appName={appName}
              logoUrl={logoUrl}
              menus={menus ?? []}
              activeMenuId={activeMenu?.id ?? null}
              ingredientCustomizationEnabled={tenantSettings?.ingredient_customization_enabled ?? false}
            />
          </div>
         </div>
        )}
      >
        {children}
      </DashboardShell>
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
    <style>{`:root{--primary:${safeCssColor(adminPrimary)};--primary-foreground:${adminPrimaryFg};--accent:${safeCssColor(adminAccent)};}`}</style>
    <DashboardShell
      appName={appName}
      contextName={profile.tenants?.name ?? 'My Restaurant'}
      logoUrl={logoUrl}
      sidebar={<AdminSidebar
        tenantName={profile.tenants?.name ?? 'My Restaurant'}
        tenantSlug={(profile.tenants as any)?.slug}
        role={profile.role}
        appName={appName}
        menus={menus ?? []}
        activeMenuId={activeMenu?.id ?? null}
        ingredientCustomizationEnabled={tenantSettings?.ingredient_customization_enabled ?? false}
      />}
    >
      {children}
    </DashboardShell>
    <DemoBanner />
    </>
  )
}
