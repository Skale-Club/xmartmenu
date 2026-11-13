export const dynamic = 'force-dynamic'

import { BRAND_NAME, BRAND_PRIMARY } from '@/lib/brand'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import DashboardShell from '@/components/admin/DashboardShell'
import SuperadminSidebar from '@/components/admin/SuperadminSidebar'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'
import { getOwnedShellPlatform } from '@/lib/auth/owned-shell-runtime'

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  if (ownedAuthSelected()) {
    const principal = await getOwnedPrincipal()
    if (!principal) redirect('/auth/login')
    if (principal.mustChangePassword) redirect('/identity?recovery=required')
    if (principal.role !== 'superadmin') redirect('/dashboard')
    const ps = await getOwnedShellPlatform(), primary = ps?.cta_color ?? BRAND_PRIMARY
    return <><style>{`:root{--primary:${safeCssColor(primary)};--primary-foreground:${computePrimaryForeground(primary)};}`}</style>
      <DashboardShell appName={ps?.app_name ?? BRAND_NAME} contextName="Super Admin" eyebrow="Super Admin Console"
        logoUrl={ps?.favicon_url} backgroundClassName="bg-zinc-50"
        sidebar={<SuperadminSidebar appName={ps?.app_name ?? BRAND_NAME} logoUrl={ps?.favicon_url} />}>{children}</DashboardShell></>
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: profile }, { data: ps }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    (await createServiceClient()).from('platform_settings').select('cta_color, app_name, favicon_url').single(),
  ])

  if (profile?.role !== 'superadmin') redirect('/dashboard')

  const primary = ps?.cta_color ?? BRAND_PRIMARY
  const primaryFg = computePrimaryForeground(primary)

  return (
    <>
    <style>{`:root{--primary:${safeCssColor(primary)};--primary-foreground:${primaryFg};}`}</style>
    <DashboardShell
      appName={ps?.app_name ?? BRAND_NAME}
      contextName="Super Admin"
      eyebrow="Super Admin Console"
      logoUrl={ps?.favicon_url}
      backgroundClassName="bg-zinc-50"
      sidebar={<SuperadminSidebar appName={ps?.app_name ?? BRAND_NAME} logoUrl={ps?.favicon_url} />}
    >
      {children}
    </DashboardShell>
    </>
  )
}
