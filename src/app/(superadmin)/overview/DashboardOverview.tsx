'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { planBadgeClass } from '@/lib/plan-badge'
import { 
  Building2, 
  Users, 
  Star, 
  Zap, 
  QrCode, 
  ArrowUpRight,
  Settings,
  ChevronRight,
  TrendingUp,
  Clock
} from 'lucide-react'

interface DashboardOverviewProps {
  allTenants: any[]
  allUsers: any[]
  unassigned: number
  planCount: {
    menu: number
    orders: number
    payments: number
  }
  totalScansToday: number
  recent: any[]
  topScanners: any[]
  active: number
}

export default function DashboardOverview({
  allTenants,
  allUsers,
  unassigned,
  planCount,
  totalScansToday,
  recent,
  topScanners,
  active
}: DashboardOverviewProps) {
  const stats = [
    { label: 'Clients', value: allTenants.length, sub: `${active} active`, icon: <Building2 className="size-4" />, tone: 'bg-primary/10 text-primary' },
    { label: 'Users', value: allUsers.length, sub: unassigned > 0 ? `${unassigned} pending` : 'All assigned', icon: <Users className="size-4" />, tone: unassigned > 0 ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-600' },
    { label: 'Ordering', value: planCount.orders + planCount.payments, sub: `${planCount.payments} with payments`, icon: <Star className="size-4" />, tone: 'bg-blue-50 text-blue-600' },
    { label: 'Menu only', value: planCount.menu, sub: 'Potential upgrades', icon: <Zap className="size-4" />, tone: 'bg-zinc-100 text-zinc-600' },
    { label: 'Scans today', value: totalScansToday, sub: 'All menus', icon: <QrCode className="size-4" />, tone: 'bg-green-50 text-green-600' },
  ]

  return (
    <div className="w-full p-4 sm:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5"
      >
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">Overview</h1>
        <p className="mt-0.5 text-sm font-medium text-zinc-500">Platform performance at a glance</p>
      </motion.div>

      {/* One compact strip: a list on phones, one row of five from md up. */}
      <ul className="mb-6 grid grid-cols-1 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white md:grid-cols-5 md:divide-x md:divide-y-0">
        {stats.map(stat => (
          <li key={stat.label} className="flex items-center gap-3 px-4 py-3 md:block md:p-5">
            <div className="flex min-w-0 flex-1 items-center gap-3 md:mb-3 md:gap-2">
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl md:size-7 md:rounded-lg ${stat.tone}`}>{stat.icon}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900 md:text-xs md:font-bold md:text-zinc-500">{stat.label}</p>
                <p className="truncate text-xs text-zinc-500 md:hidden">{stat.sub}</p>
              </div>
            </div>
            <p className="text-xl font-black tabular-nums text-zinc-900 md:text-3xl md:leading-none">{stat.value}</p>
            <p className="mt-2 hidden truncate text-xs font-medium text-zinc-500 md:block">{stat.sub}</p>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent clients */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-6 w-1.5 rounded-full bg-primary" />
              <h2 className="text-base font-bold text-zinc-900">Recent clients</h2>
            </div>
            <Link href="/tenants" className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 hover:scale-105 bg-primary px-4 py-2 rounded-full transition-all">
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="space-y-1">
            {recent.map((t, idx) => (
              <Link key={t.id} href={`/tenants/${t.id}`}>
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-zinc-50 transition-all border border-transparent hover:border-zinc-100 cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center font-bold text-zinc-400">
                    {t.name?.[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{t.name}</p>
                    <p className="text-xs text-zinc-400 flex items-center gap-2">
                      <span className="font-mono">/{t.slug}</span>
                      <span className="opacity-30">•</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase tracking-tight ${planBadgeClass(t.plan)}`}>{t.plan}</span>
                  <div className={`w-2 h-2 rounded-full ${t.is_active ? 'bg-green-500 shadow-sm shadow-green-100' : 'bg-zinc-300'}`} />
                </div>
              </motion.div>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick actions & Scans Sidebar */}
        <div className="space-y-6">
          {/* Today's scans */}
          <div className="rounded-2xl bg-zinc-950 p-5 text-white sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Store Activity</h2>
            </div>
            {topScanners.length === 0 ? (
              <p className="text-sm text-zinc-500 italic">No activity recorded today.</p>
            ) : (
              <div className="space-y-3">
                {topScanners.map(t => (
                  <div key={t.id} className="flex items-center justify-between group">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">{t.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono tracking-tight">/{t.slug}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-black text-white">{t.scans}</p>
                      <p className="text-[8px] font-bold text-zinc-700 uppercase tracking-tighter">scans</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <h2 className="mb-3 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">Internal tools</h2>
            <div className="space-y-1">
              {[
                { href: '/tenants', icon: <Building2 className="w-4 h-4" />, label: 'Manage Clients', desc: 'Instances & Tenants', color: 'bg-primary text-primary-foreground' },
                { href: '/users', icon: <Users className="w-4 h-4" />, label: 'Manage Users', desc: 'Permissions & Access', color: 'bg-zinc-100 text-zinc-600' },
                { href: '/settings', icon: <Settings className="w-4 h-4" />, label: 'System Settings', desc: 'Global configuration', color: 'bg-zinc-100 text-zinc-600' },
              ].map(item => (
                <Link key={item.href} href={item.href} className="group flex items-center gap-3 rounded-xl p-2.5 hover:bg-zinc-50 transition-all border border-transparent hover:border-zinc-100">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.color} group-hover:scale-110 transition-transform`}>
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-900 group-hover:text-zinc-600 transition-colors">{item.label}</p>
                    <p className="text-[10px] text-zinc-500 font-medium">{item.desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-400 group-hover:translate-x-1 transition-all" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

