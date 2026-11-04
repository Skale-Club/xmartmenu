export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import { listAllAuthUsers } from '@/lib/admin/list-auth-users'
import { isPendingTenantAssignment } from '@/lib/admin/tenant-management'
import DashboardOverview from './DashboardOverview'
import PlatformActivity from './PlatformActivity'
import { normalizePlatformOverview } from '@/lib/analytics/engagement'
import { redirect } from 'next/navigation'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'
import { ownedShellRepository } from '@/lib/auth/owned-shell-runtime'

const ACTIVITY_DAYS = 30

async function overviewData() {
  if (ownedAuthSelected()) {
    const principal = await getOwnedPrincipal()
    if (!principal) redirect('/auth/login')
    if (principal.role !== 'superadmin' || principal.mustChangePassword) redirect('/dashboard')
    return ownedShellRepository().overview(principal)
  }
  const service = await createServiceClient()

  // Today in UTC-3
  const todayBRT = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [
    { data: tenants },
    { data: profiles },
    allUsers,
    { data: scansToday },
    { data: activity },
  ] = await Promise.all([
    service.from('tenants').select('id, name, slug, plan, is_active, created_at'),
    service.from('profiles').select('id, role, tenant_id'),
    listAllAuthUsers(service),
    service.from('scan_events').select('tenant_id').gte('scanned_at', `${todayBRT}T03:00:00.000Z`),
    service.rpc('get_platform_menu_overview', {
      p_started_at: new Date(Date.now() - ACTIVITY_DAYS * 86_400_000).toISOString(),
      p_ended_at: new Date().toISOString(),
    }),
  ])
  return { tenants: tenants ?? [], profiles: profiles ?? [], users: allUsers, scans: scansToday ?? [], activity }
}

export default async function OverviewPage() {
  const { tenants: allTenants, profiles: allProfiles, users: allUsers, scans: scansToday, activity } = await overviewData()

  // Today's scans grouped by tenant
  const scanMap: Record<string, number> = {}
  for (const s of scansToday ?? []) {
    scanMap[s.tenant_id] = (scanMap[s.tenant_id] ?? 0) + 1
  }
  const totalScansToday = (scansToday ?? []).length
  const topScanners = allTenants
    .map(t => ({ ...t, scans: scanMap[t.id] ?? 0 }))
    .filter(t => t.scans > 0)
    .sort((a, b) => b.scans - a.scans)
    .slice(0, 5)

  const active = allTenants.filter(t => t.is_active).length
  const planCount = {
    menu: allTenants.filter(t => t.plan === 'menu').length,
    orders: allTenants.filter(t => t.plan === 'orders').length,
    payments: allTenants.filter(t => t.plan === 'payments').length,
  }
  const unassigned = allProfiles.filter(p => isPendingTenantAssignment(p)).length
  const recent = [...allTenants]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)

  return (
    <>
    <DashboardOverview 
      allTenants={allTenants}
      allUsers={allUsers}
      unassigned={unassigned}
      planCount={planCount}
      totalScansToday={totalScansToday}
      recent={recent}
      topScanners={topScanners}
      active={active}
    />
    <PlatformActivity rows={normalizePlatformOverview(activity)} days={ACTIVITY_DAYS} />
    </>
  )
}
