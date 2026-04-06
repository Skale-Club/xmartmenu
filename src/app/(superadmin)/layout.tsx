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
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Skale Club</p>
          <p className="text-sm font-semibold">QR Menu — Superadmin</p>
        </div>
        <nav className="flex-1 p-3">
          <a href="/tenants" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
            <span>🏢</span> Clientes
          </a>
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
