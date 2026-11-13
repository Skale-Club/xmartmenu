import { BRAND_NAME, BRAND_PRIMARY } from '@/lib/brand'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'
import { getOwnedShellPlatform, getOwnedShellTenant } from '@/lib/auth/owned-shell-runtime'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { activeAdminMenu } from '@/lib/data/admin-menus'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import AdminSidebar from './AdminSidebar'
import DashboardShell from './DashboardShell'
import DemoBanner from '@/components/demo/DemoBanner'

export default async function OwnedAdminLayout({ children }: { children: React.ReactNode }) {
  const principal = await getOwnedPrincipal()
  if (!principal) redirect('/auth/login')
  if (principal.mustChangePassword) redirect('/identity?recovery=required')
  if (principal.role === 'customer') redirect('/')
  const cookieStore = await cookies()
  if (principal.role === 'superadmin' && !cookieStore.get('preview_tenant_id')?.value) redirect('/overview')
  const effective = await getEffectiveTenant()
  if (!effective) redirect(principal.role === 'superadmin' ? '/tenants' : '/onboarding')
  const [platform, context] = await Promise.all([
    getOwnedShellPlatform(), getOwnedShellTenant(principal, effective.tenantId),
  ])
  const active = activeAdminMenu(context.menus, cookieStore.get('selected_menu_id')?.value)
  const primary = context.settings?.primary_color ?? BRAND_PRIMARY
  const accent = context.settings?.accent_color ?? '#09090b'
  const preview = principal.role === 'superadmin'
  const exitHref = `/api/admin/exit-preview?next=${encodeURIComponent(`/tenants/${effective.tenantId}`)}`
  return <>
    <style>{`:root{--primary:${safeCssColor(primary)};--primary-foreground:${computePrimaryForeground(primary)};--accent:${safeCssColor(accent)};}`}</style>
    <DashboardShell appName={platform?.app_name ?? BRAND_NAME} contextName={effective.name}
      eyebrow={preview ? 'Preview mode' : undefined} logoUrl={platform?.favicon_url}
      headerAction={preview ? <a href={exitHref} aria-label={`Return to ${effective.name} management`} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-xs font-bold text-white"><ArrowLeft className="size-4" />Back</a> : undefined}
      sidebar={<div className="flex h-full flex-col bg-zinc-950">
        {preview && <div className="bg-primary text-primary-foreground text-[10px] py-2 font-black uppercase tracking-widest flex items-center justify-center gap-2"><span>Viewing: {effective.name}</span><a href={exitHref} className="flex min-h-8 items-center rounded-lg bg-zinc-950 px-3 text-[9px] text-white">Exit preview</a></div>}
        <div className="min-h-0 flex-1"><AdminSidebar tenantName={effective.name} tenantSlug={effective.slug} role={principal.role}
          appName={platform?.app_name ?? BRAND_NAME} logoUrl={platform?.favicon_url} menus={context.menus}
          activeMenuId={active?.id ?? null} capabilities={context.capabilities} chatAvailable={context.chat.available} ownedAuth /></div>
      </div>}>{children}</DashboardShell>
    {!preview && <DemoBanner />}
  </>
}
