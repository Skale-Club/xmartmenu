export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'superadmin') redirect('/dashboard')

  return (
    <div className="flex h-screen bg-zinc-50">
      <aside className="w-60 flex-shrink-0 bg-zinc-900 text-white flex flex-col">
        <div className="p-5 border-b border-zinc-700">
          <a href="/" className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1 hover:text-zinc-200 transition-colors">XmartMenu</a>
          <p className="text-sm font-semibold">XmartMenu — Super Admin</p>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          <a href="/overview" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
            <span>📊</span> Dashboard
          </a>
          <a href="/tenants" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
            <span>🏢</span> Clients
          </a>
          <a href="/users" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
            <span>👥</span> Users
          </a>
<a href="/settings" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
            <span>⚙️</span> Settings
          </a>
        </nav>
        <div className="p-3 border-t border-zinc-700">
          <a href="/api/auth/signout" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">
            <span>→</span> Sign out
          </a>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
