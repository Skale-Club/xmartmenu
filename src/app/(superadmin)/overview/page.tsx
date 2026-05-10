export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import DashboardOverview from './DashboardOverview'

export default async function OverviewPage() {
  const service = await createServiceClient()

  // Today in UTC-3
  const todayBRT = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [
    { data: tenants },
    { data: profiles },
    { data: authData },
    { data: scansToday },
  ] = await Promise.all([
    service.from('tenants').select('id, name, slug, plan, is_active, created_at'),
    service.from('profiles').select('id, role, tenant_id'),
    service.auth.admin.listUsers({ perPage: 1000 }),
    service.from('scan_events').select('tenant_id').gte('scanned_at', `${todayBRT}T03:00:00.000Z`),
  ])

  const allTenants = tenants ?? []
  const allProfiles = profiles ?? []
  const allUsers = authData?.users ?? []

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
    free: allTenants.filter(t => t.plan === 'free').length,
    pro: allTenants.filter(t => t.plan === 'pro').length,
    enterprise: allTenants.filter(t => t.plan === 'enterprise').length,
  }
  const unassigned = allProfiles.filter(p => !p.tenant_id && p.role !== 'superadmin').length
  const recent = [...allTenants]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)

  return (
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
  )
}
