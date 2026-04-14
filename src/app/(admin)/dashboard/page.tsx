export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'

export default async function DashboardPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const tenantId = effective?.tenantId

  const [
    { count: totalProducts },
    { count: totalCategories },
    { count: scansToday },
  ] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('categories').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('scan_events')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('scanned_at', `${new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0]}T03:00:00.000Z`),
  ])

  const stats = [
    { label: 'Products', value: totalProducts ?? 0, icon: '🍽️' },
    { label: 'Categories', value: totalCategories ?? 0, icon: '📂' },
    { label: 'Scans today', value: scansToday ?? 0, icon: '📱' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-zinc-900 mb-2">Dashboard</h1>
      <p className="text-sm text-zinc-500 mb-8">Overview of your menu</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-zinc-200 p-6">
            <div className="text-3xl mb-3">{stat.icon}</div>
            <p className="text-3xl font-bold text-zinc-900">{stat.value}</p>
            <p className="text-sm text-zinc-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-4">Quick start</h2>
        <div className="space-y-3 text-sm text-zinc-600">
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs flex items-center justify-center font-bold">1</span>
            <span>Set up your restaurant branding in <strong>Settings → Branding</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs flex items-center justify-center font-bold">2</span>
            <span>Create your categories in <strong>Menu → Categories</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs flex items-center justify-center font-bold">3</span>
            <span>Add your products in <strong>Menu → Products</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs flex items-center justify-center font-bold">4</span>
            <span>Generate and print your QR Code in <strong>QR Code</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
