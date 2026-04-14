export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function OverviewPage() {
  const service = await createServiceClient()

  // Hoje no fuso de Brasília (UTC-3)
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

  // Scans de hoje agrupados por tenant
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
  const inactive = allTenants.length - active
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
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Platform overview</p>
      </div>

      {/* Cards de stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total clients" value={allTenants.length} sub={`${active} active · ${inactive} inactive`} color="zinc" />
        <StatCard label="Users" value={allUsers.length} sub={unassigned > 0 ? `${unassigned} unassigned` : 'all assigned'} color={unassigned > 0 ? 'amber' : 'zinc'} />
        <StatCard label="Pro plan" value={planCount.pro} sub={`${planCount.enterprise} enterprise`} color="blue" />
        <StatCard label="Free plan" value={planCount.free} sub="no subscription" color="zinc" />
        <StatCard label="Scans today" value={totalScansToday} sub="all stores" color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Clientes recentes */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Recent clients</h2>
            <Link href="/tenants" className="text-xs text-zinc-500 hover:text-zinc-900 underline">View all</Link>
          </div>
          <div className="space-y-2">
            {recent.map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-zinc-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{t.name}</p>
                  <p className="text-xs text-zinc-400">/{t.slug} · {new Date(t.created_at).toLocaleDateString('en-US')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    t.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
                    t.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                    'bg-zinc-100 text-zinc-500'
                  }`}>{t.plan}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    t.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-400'
                  }`}>{t.is_active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scans hoje */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Scans today by store</h2>
          {topScanners.length === 0 ? (
            <p className="text-sm text-zinc-400">No scans recorded today.</p>
          ) : (
            <div className="space-y-2">
              {topScanners.map(t => (
                <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-zinc-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{t.name}</p>
                    <p className="text-xs text-zinc-400">/{t.slug}</p>
                  </div>
                  <span className="text-sm font-bold text-zinc-900 bg-zinc-100 px-2.5 py-0.5 rounded-full">
                    {t.scans} scans
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ações rápidas */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Quick actions</h2>
          <div className="space-y-2">
            {[
              { href: '/tenants', icon: '🏢', label: 'Manage clients', desc: 'Create, edit and delete tenants' },
              { href: '/users', icon: '👥', label: 'Manage users', desc: 'Assign roles and tenants' },
              { href: '/settings', icon: '⚙️', label: 'Platform settings', desc: 'Text, colors and landing page' },
            ].map(item => (
              <Link key={item.href} href={item.href} className="flex items-center gap-4 p-3 rounded-xl hover:bg-zinc-50 transition-colors border border-transparent hover:border-zinc-200">
                <span className="text-2xl">{item.icon}</span>
                <div>
                  <p className="text-sm font-medium text-zinc-900">{item.label}</p>
                  <p className="text-xs text-zinc-400">{item.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  const colors: Record<string, string> = {
    zinc: 'bg-zinc-50 border-zinc-200',
    blue: 'bg-blue-50 border-blue-200',
    amber: 'bg-amber-50 border-amber-200',
    green: 'bg-green-50 border-green-200',
  }
  return (
    <div className={`border rounded-xl p-5 ${colors[color] ?? colors.zinc}`}>
      <p className="text-xs font-medium text-zinc-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-zinc-900">{value}</p>
      <p className="text-xs text-zinc-400 mt-1">{sub}</p>
    </div>
  )
}
