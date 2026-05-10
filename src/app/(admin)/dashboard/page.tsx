export const dynamic = 'force-dynamic'

import { CopyMenuUrl } from '@/components/admin/CopyMenuUrl'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { 
  Utensils, 
  FolderTree, 
  QrCode, 
  Sparkles, 
  ArrowRight,
  TrendingUp,
  LayoutDashboard,
  CheckCircle2,
  Settings,
  Menu as MenuIcon
} from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const tenantId = effective?.tenantId
  const activeMenu = tenantId ? await getActiveMenuForTenant(tenantId) : null

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
    { label: 'Products', value: totalProducts ?? 0, icon: Utensils, color: 'primary' },
    { label: 'Categories', value: totalCategories ?? 0, icon: FolderTree, color: 'zinc' },
    { label: 'Scans today', value: scansToday ?? 0, icon: QrCode, color: 'zinc' },
  ]

  const quickStartSteps = [
    { 
      id: 1, 
      label: 'Branding', 
      desc: 'Set up your restaurant branding', 
      link: 'Settings → Branding',
      icon: Settings
    },
    { 
      id: 2, 
      label: 'Categories', 
      desc: 'Create your food categories', 
      link: 'Menu → Categories',
      icon: FolderTree
    },
    { 
      id: 3, 
      label: 'Products', 
      desc: 'Add your delicious products', 
      link: 'Menu → Products',
      icon: Utensils
    },
    { 
      id: 4, 
      label: 'QR Code', 
      desc: 'Generate and print your code', 
      link: 'QR Code',
      icon: QrCode
    },
  ]

  return (
    <div className="p-8 w-full space-y-10">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-4 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <LayoutDashboard className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Dashboard</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Welcome back!</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Here is what is happening with your menu today.</p>
        </div>
        {effective?.slug && (
          <CopyMenuUrl path={`/${effective.slug}${activeMenu && !activeMenu.is_default ? `/${activeMenu.slug}` : ''}`} />
        )}
      </div>

       {/* Stats Cards */}
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {stats.map((stat) => (
           <div 
             key={stat.label} 
             className="group relative bg-white rounded-[1.25rem] p-8 border border-zinc-100 transition-all hover:border-primary/50"
           >
             <div className="flex items-center gap-5">
               <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${stat.color === 'primary' ? 'bg-primary text-zinc-950' : 'bg-zinc-100 text-zinc-400'} transition-colors group-hover:scale-110 duration-300`}>
                 <stat.icon className="w-6 h-6" />
               </div>
               <div className="flex-1">
                 <p className="text-4xl font-black text-zinc-950 tracking-tighter">{stat.value}</p>
                 <p className="text-xs font-black uppercase tracking-widest text-zinc-400 mt-1">{stat.label}</p>
               </div>
             </div>
             <div className="absolute top-8 right-8">
               <TrendingUp className="w-4 h-4 text-zinc-200 group-hover:text-primary transition-colors" />
             </div>
           </div>
         ))}
       </div>

      {/* Quick Start Section */}
      <div className="relative bg-zinc-950 rounded-[0.75rem] p-10 overflow-hidden group">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[80px] -mr-32 -mt-32 transition-opacity group-hover:opacity-100 opacity-50" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-zinc-950" />
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">Quick Start Guide</h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {quickStartSteps.map((step) => (
              <div 
                key={step.id} 
                className="bg-white/5 border border-white/10 rounded-[0.5rem] p-6 hover:bg-white/10 transition-all group/step cursor-default"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black text-primary uppercase tracking-widest">Step {step.id}</span>
                  <step.icon className="w-4 h-4 text-zinc-600 group-hover/step:text-primary transition-colors" />
                </div>
                <p className="text-lg font-bold text-white mb-1">{step.label}</p>
                <p className="text-xs text-zinc-500 font-medium mb-4">{step.desc}</p>
                <div className="flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-widest group-hover/step:text-primary transition-colors">
                  Go to {step.link}
                  <ArrowRight className="w-3 h-3 translate-x-0 group-hover/step:translate-x-1 transition-transform" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
