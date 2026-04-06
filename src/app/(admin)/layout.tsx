import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, tenants(*)')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/auth/login')
  if (profile.role === 'superadmin') redirect('/tenants')

  return (
    <div className="flex h-screen bg-zinc-50">
      <AdminSidebar tenantName={profile.tenants?.name ?? 'Meu Restaurante'} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
