export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
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

  // Superadmin pode acessar o painel de qualquer tenant via cookie
  if (profile.role === 'superadmin') {
    const cookieStore = await cookies()
    const previewTenantId = cookieStore.get('preview_tenant_id')?.value

    if (!previewTenantId) redirect('/tenants')

    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', previewTenantId)
      .single()

    if (!tenant) redirect('/tenants')

    return (
      <div className="flex h-screen bg-zinc-50">
        <div className="flex flex-col w-60 flex-shrink-0">
          <div className="bg-amber-500 text-white text-xs text-center py-1.5 font-medium">
            Visualizando: {tenant.name}
            <a href="/api/admin/exit-preview" className="ml-2 underline">Sair</a>
          </div>
          <div className="flex-1">
            <AdminSidebar tenantName={tenant.name} />
          </div>
        </div>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-zinc-50">
      <AdminSidebar tenantName={profile.tenants?.name ?? 'Meu Restaurante'} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
