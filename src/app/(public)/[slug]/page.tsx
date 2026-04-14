export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import MenuPage from '@/components/menu/MenuPage'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, tenant_settings(logo_url)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!tenant) return { title: 'Menu' }

  return {
    title: `Menu — ${tenant.name}`,
    description: `View the full menu of ${tenant.name}`,
    openGraph: {
      title: `Menu — ${tenant.name}`,
      images: [(tenant.tenant_settings as any)?.logo_url ?? ''],
    },
  }
}

export default async function PublicMenuPage({ params }: Props) {
  const { slug } = await params
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*, tenant_settings(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!tenant) notFound()

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from('categories')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('position'),
    supabase
      .from('products')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('is_available', true)
      .order('position'),
  ])

  // Registra scan (fire-and-forget)
  supabase.from('scan_events').insert({ tenant_id: tenant.id }).then(() => {})

  return (
    <MenuPage
      tenant={tenant}
      categories={categories ?? []}
      products={products ?? []}
    />
  )
}
