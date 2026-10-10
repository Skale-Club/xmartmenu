export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import DashboardShell from '@/components/admin/DashboardShell'
import SuperadminSidebar from '@/components/admin/SuperadminSidebar'

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: profile }, { data: ps }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    (await createServiceClient()).from('platform_settings').select('cta_color, app_name, favicon_url').single(),
  ])

  if (profile?.role !== 'superadmin') redirect('/dashboard')

  const primary = ps?.cta_color ?? '#F52323'
  const primaryFg = computePrimaryForeground(primary)

  return (
    <>
    <style>{`:root{--primary:${safeCssColor(primary)};--primary-foreground:${primaryFg};}`}</style>
    <DashboardShell
      appName={ps?.app_name ?? 'XmartMenu'}
      contextName="Super Admin"
      eyebrow="Super Admin Console"
      logoUrl={ps?.favicon_url}
      backgroundClassName="bg-zinc-50"
      sidebar={<SuperadminSidebar appName={ps?.app_name ?? 'XmartMenu'} logoUrl={ps?.favicon_url} />}
    >
      {children}
    </DashboardShell>
    </>
  )
}
