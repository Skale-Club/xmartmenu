'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
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
    free: number
    pro: number
    enterprise: number
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
  return (
    <div className="p-8 w-full">
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Overview</h1>
        <p className="text-sm text-zinc-500 mt-1 font-medium">Real-time platform performance and management</p>
      </motion.div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 mb-10">
        <StatCard 
          label="Total clients" 
          value={allTenants.length} 
          sub={`${active} active restaurants`} 
          icon={<Building2 className="w-5 h-5" />}
          color="primary" 
        />
        <StatCard 
          label="Total Users" 
          value={allUsers.length} 
          sub={unassigned > 0 ? `${unassigned} pending assignment` : 'All assigned'} 
          icon={<Users className="w-5 h-5" />}
          color={unassigned > 0 ? 'amber' : 'zinc'} 
        />
        <StatCard 
          label="Revenue Clients" 
          value={planCount.pro + planCount.enterprise} 
          sub={`${planCount.enterprise} enterprise tier`} 
          icon={<Star className="w-5 h-5" />}
          color="blue" 
        />
        <StatCard 
          label="Free Tier" 
          value={planCount.free} 
          sub="Potential upgrades" 
          icon={<Zap className="w-5 h-5" />}
          color="zinc" 
        />
        <StatCard 
          label="Today's Scans" 
          value={totalScansToday} 
          sub="Engagement total" 
          icon={<QrCode className="w-5 h-5" />}
          color="green" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent clients */}
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-[1.25rem] p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <div className="w-2 h-8 bg-primary rounded-full" />
              <h2 className="text-lg font-bold text-zinc-900">Recent Clients</h2>
            </div>
            <Link href="/tenants" className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 hover:scale-105 bg-primary px-4 py-2 rounded-full transition-all">
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="space-y-4">
            {recent.map((t, idx) => (
              <Link key={t.id} href={`/tenants/${t.id}`}>
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 transition-all border border-transparent hover:border-zinc-100 cursor-pointer"
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
                  <span className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase tracking-tight ${
                    t.plan === 'pro' ? 'bg-blue-50 text-blue-600' :
                    t.plan === 'enterprise' ? 'bg-purple-50 text-purple-600' :
                    'bg-zinc-50 text-zinc-400'
                  }`}>{t.plan}</span>
                  <div className={`w-2 h-2 rounded-full ${t.is_active ? 'bg-green-500 shadow-sm shadow-green-100' : 'bg-zinc-300'}`} />
                </div>
              </motion.div>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick actions & Scans Sidebar */}
        <div className="space-y-8">
          {/* Today's scans */}
          <div className="bg-zinc-950 rounded-[1.25rem] p-8 text-white shadow-xl">
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Store Activity</h2>
            </div>
            {topScanners.length === 0 ? (
              <p className="text-sm text-zinc-500 italic">No activity recorded today.</p>
            ) : (
              <div className="space-y-5">
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
          <div className="bg-white border border-zinc-200 rounded-[1.25rem] p-8 shadow-sm">
            <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] mb-6">Internal Tools</h2>
            <div className="space-y-3">
              {[
                { href: '/tenants', icon: <Building2 className="w-4 h-4" />, label: 'Manage Clients', desc: 'Instances & Tenants', color: 'bg-primary text-primary-foreground' },
                { href: '/users', icon: <Users className="w-4 h-4" />, label: 'Manage Users', desc: 'Permissions & Access', color: 'bg-zinc-100 text-zinc-600' },
                { href: '/settings', icon: <Settings className="w-4 h-4" />, label: 'System Settings', desc: 'Global configuration', color: 'bg-zinc-100 text-zinc-600' },
              ].map(item => (
                <Link key={item.href} href={item.href} className="group flex items-center gap-4 p-4 rounded-xl hover:bg-zinc-50 transition-all border border-transparent hover:border-zinc-100">
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

function StatCard({ label, value, sub, icon, color }: { label: string; value: number; sub: string; icon: React.ReactNode; color: string }) {
  const colors: Record<string, string> = {
    primary: 'border-primary/20 bg-primary/10 text-zinc-900',
    blue: 'border-blue-100 bg-blue-50/30 text-blue-600',
    amber: 'border-amber-100 bg-amber-50/30 text-amber-600',
    green: 'border-green-100 bg-green-50/30 text-green-600',
    zinc: 'border-zinc-200 bg-zinc-50/50 text-zinc-600',
  }
  
  return (
    <div className="group relative bg-white border border-zinc-200 rounded-[1rem] p-5 hover:border-primary/50 transition-all duration-300">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-xl border ${colors[color] || colors.zinc}`}>
          {icon}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowUpRight className="w-4 h-4 text-zinc-300" />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-black text-zinc-900 mt-1">{value}</p>
        <p className="text-[10px] font-medium text-zinc-500 mt-1.5 flex items-center gap-1">
          {sub}
        </p>
      </div>
    </div>
  )
}
