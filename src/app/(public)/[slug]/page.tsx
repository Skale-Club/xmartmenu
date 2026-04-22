export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import MenuPage from '@/components/menu/MenuPage'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string }>
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

export default async function PublicMenuPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { lang } = await searchParams
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*, tenant_settings(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!tenant) notFound()

  const { data: menu } = await supabase
    .from('menus')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle()

  const resolvedMenu = menu ?? (await supabase
    .from('menus')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('position')
    .limit(1)
    .maybeSingle()).data

  let categories: any[] = []
  let products: any[] = []

  if (resolvedMenu?.id) {
    const response = await Promise.all([
      supabase
        .from('categories')
        .select('*')
        .eq('menu_id', resolvedMenu.id)
        .eq('is_active', true)
        .order('position'),
      supabase
        .from('products')
        .select('*')
        .eq('menu_id', resolvedMenu.id)
        .eq('is_available', true)
        .order('position'),
    ])

    categories = response[0].data ?? []
    products = response[1].data ?? []
  }

  // Registra scan (fire-and-forget)
  supabase.from('scan_events').insert({ tenant_id: tenant.id }).then(() => {})

  return (
    <MenuPage
      tenant={tenant}
      categories={categories}
      products={products}
      menu={resolvedMenu ?? null}
      initialLanguage={lang}
    />
  )
}
