export const dynamic = 'force-dynamic'

import { CopyMenuUrl } from '@/components/admin/CopyMenuUrl'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { getTenantPlan } from '@/lib/tenant-plan'
import { resolveTenantCapabilities, type ServiceSettings } from '@/lib/service-modes'
import { includedInPlan, quickStartPlan } from '@/components/admin/plan-views'
import { lockedGroups } from '@/components/admin/plan-hint'
import PlanHintCard from '@/components/admin/PlanHintCard'
import Link from 'next/link'
import { 
  Utensils, 
  FolderTree, 
  QrCode, 
  Sparkles, 
  ArrowRight,
  TrendingUp,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  Check,
} from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const tenantId = effective?.tenantId
  const activeMenu = tenantId ? await getActiveMenuForTenant(tenantId) : null

  const [
    { data: publicMenus },
    { count: totalProducts },
    { count: totalCategories },
    { count: scansToday },
    { data: serviceSettings },
    plan,
  ] = await Promise.all([
    supabase.from('menus').select('id, name, slug').eq('tenant_id', tenantId).eq('is_active', true).order('position'),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('categories').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('scan_events')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('scanned_at', `${new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0]}T03:00:00.000Z`),
    supabase.from('tenant_settings')
      .select('orders_enabled, direct_orders_enabled, table_management_enabled, whatsapp_orders_enabled, whatsapp, tips_enabled, item_notes_enabled, ingredient_customization_enabled, dine_in_enabled, pickup_enabled, delivery_enabled, upsell_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    tenantId ? getTenantPlan(tenantId).catch(() => null) : Promise.resolve(null),
  ])

  const capabilities = resolveTenantCapabilities(plan?.features, (serviceSettings ?? null) as ServiceSettings | null)
  const isOwner = effective?.role !== 'store-staff'
  const included = includedInPlan(capabilities.plan)
  const missing = lockedGroups(capabilities.plan, [
    { need: 'orders', label: 'Waiter app, tables and kitchen display' },
    { need: 'payments', label: 'Guest ordering and payments' },
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
    // The plan sells ordering but nothing is switched on yet.
    ...(isOwner && quickStartPlan(capabilities).turnOnOrdering ? [{
      id: 5,
      label: 'Turn on ordering',
      desc: capabilities.plan.payments ? 'Let guests order from the menu' : 'Let your staff take orders',
      link: 'Settings → Store',
      href: '/settings/store',
      icon: ShoppingCart,
    }] : []),
  ]

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 lg:space-y-8 lg:p-8">
      {/* Header Section */}
      <div className="flex flex-col justify-between gap-5 border-b border-zinc-200 pb-5 xl:flex-row xl:items-end">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <LayoutDashboard className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Dashboard</span>
            {plan && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary">{plan.name}</span>
            )}
          </div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">Welcome back!</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Here is what is happening with your menu today.</p>
        </div>
        {effective?.slug && (
          <CopyMenuUrl
            homePath={`/${effective.slug}`}
            menus={(publicMenus ?? []).map(menu => ({
              name: menu.name,
              path: `/${effective.slug}/${menu.slug}`,
              isActive: menu.id === activeMenu?.id,
            }))}
          />
        )}
      </div>

       {/* Stats Cards */}
       <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:gap-6">
         {stats.map((stat) => (
           <div 
             key={stat.label} 
             className="group relative min-w-0 rounded-2xl border border-zinc-100 bg-white p-3 transition-[border-color,box-shadow] duration-150 hover:border-primary/50 hover:shadow-sm sm:p-4 lg:p-8"
           >
             <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:gap-5">
               <div className={`flex size-10 flex-shrink-0 items-center justify-center rounded-xl lg:size-12 ${stat.color === 'primary' ? 'bg-primary text-primary-foreground' : 'bg-zinc-100 text-zinc-400'} transition-[background-color,scale] duration-150 group-hover:scale-105`}>
                 <stat.icon className="size-5 lg:size-6" />
               </div>
               <div className="min-w-0 flex-1">
                 <p className="text-2xl font-black tracking-tighter text-zinc-950 tabular-nums sm:text-3xl lg:text-4xl">{stat.value}</p>
                 <p className="mt-0.5 text-[9px] font-black uppercase leading-tight tracking-wider text-zinc-400 sm:text-[10px] lg:mt-1 lg:text-xs lg:tracking-widest">{stat.label}</p>
               </div>
             </div>
             <div className="absolute right-8 top-8 hidden lg:block">
               <TrendingUp className="w-4 h-4 text-zinc-200 group-hover:text-primary transition-colors" />
             </div>
           </div>
         ))}
       </div>

      {/* Plan */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[1.25rem] border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-black tracking-tight text-zinc-950">Included in your plan</h2>
            <span className="rounded-full bg-zinc-950 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">{plan?.name ?? 'No plan'}</span>
          </div>
          <ul className="space-y-2">
            {included.map(line => (
              <li key={line} className="flex items-start gap-2 text-sm font-medium text-zinc-600">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        {isOwner && missing.length > 0 && <PlanHintCard groups={missing} className="self-start" />}
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
          
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 ${quickStartSteps.length > 4 ? 'xl:grid-cols-5' : 'lg:grid-cols-4'}`}>
            {quickStartSteps.map((step) => {
              const className = `bg-white/5 border border-white/10 rounded-[0.5rem] p-6 hover:bg-white/10 transition-all group/step ${step.href ? 'cursor-pointer' : 'cursor-default'}`
              const content = (
                <>
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
                </>
              )
              return step.href
                ? <Link key={step.id} href={step.href} className={className}>{content}</Link>
                : <div key={step.id} className={className}>{content}</div>
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
