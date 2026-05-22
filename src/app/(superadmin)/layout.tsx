export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { computePrimaryForeground } from '@/lib/color-utils'
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  Settings, 
  ClipboardList, 
  LogOut,
  Globe
} from 'lucide-react'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
})

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: profile }, { data: ps }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    (await createServiceClient()).from('platform_settings').select('cta_color, app_name').single(),
  ])

  if (profile?.role !== 'superadmin') redirect('/dashboard')

  const primary = ps?.cta_color ?? '#EEFF00'
  const primaryFg = computePrimaryForeground(primary)

  return (
    <>
    <style>{`:root{--primary:${primary};--primary-foreground:${primaryFg};}`}</style>
    <div className="flex h-screen bg-zinc-50">
      <aside className="w-64 flex-shrink-0 bg-zinc-950 text-zinc-400 flex flex-col border-r border-zinc-800">
        <div className="p-6 border-b border-zinc-800/50">
          <div className="flex items-center gap-2 mb-1">
            <img src="/icon.png" alt="XmartMenu Logo" className="w-6 h-6 object-cover rounded-md" />
            <a href="/" className="text-xs font-bold text-white uppercase tracking-[0.2em] hover:text-primary transition-colors">{ps?.app_name ?? 'XmartMenu'}</a>
          </div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Super Admin Console</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <a href="/overview" className="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold hover:bg-zinc-900 hover:text-white transition-all">
            <LayoutDashboard className="w-4 h-4 text-zinc-500 group-hover:text-primary transition-colors" /> 
            Dashboard
          </a>
          <a href="/tenants" className="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold hover:bg-zinc-900 hover:text-white transition-all">
            <Building2 className="w-4 h-4 text-zinc-500 group-hover:text-primary transition-colors" /> 
            Clients
          </a>
          <a href="/users" className="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold hover:bg-zinc-900 hover:text-white transition-all">
            <Users className="w-4 h-4 text-zinc-500 group-hover:text-primary transition-colors" /> 
            Users
          </a>
          <div className="pt-4 pb-2 px-3">
            <div className="h-px bg-zinc-800/50 w-full" />
          </div>
          <a href="/plans" className="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold hover:bg-zinc-900 hover:text-white transition-all">
            <ClipboardList className="w-4 h-4 text-zinc-500 group-hover:text-primary transition-colors" /> 
            Plans
          </a>
          <a href="/settings" className="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold hover:bg-zinc-900 hover:text-white transition-all">
            <Settings className="w-4 h-4 text-zinc-500 group-hover:text-primary transition-colors" /> 
            Settings
          </a>
        </nav>

        <div className="p-4 border-t border-zinc-800/50">
          <form action="/api/auth/signout" method="post">
            <button type="submit" className="w-full group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold text-zinc-500 hover:bg-red-500/10 hover:text-red-500 transition-all">
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
    </>
  )
}
