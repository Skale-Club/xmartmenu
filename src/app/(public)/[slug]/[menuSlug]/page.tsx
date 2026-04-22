export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import MenuPage from '@/components/menu/MenuPage'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string; menuSlug: string }>
  searchParams: Promise<{ lang?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, menuSlug } = await params
  const supabase = await createServiceClient()
  const { data: tenant } = await supabase.from('tenants').select('name').eq('slug', slug).eq('is_active', true).single()
  const { data: menu } = await supabase.from('menus').select('name').eq('slug', menuSlug).single()
  if (!tenant) return { title: 'Menu' }
  return { title: `${menu?.name ?? 'Menu'} — ${tenant.name}` }
}

export default async function PublicMenuSlugPage({ params, searchParams }: Props) {
  const { slug, menuSlug } = await params
  const { lang } = await searchParams
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase.from('tenants').select('*, tenant_settings(*)').eq('slug', slug).eq('is_active', true).single()
  if (!tenant) notFound()

  const { data: menu } = await supabase.from('menus').select('*').eq('tenant_id', tenant.id).eq('slug', menuSlug).eq('is_active', true).single()
  if (!menu) notFound()

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from('categories').select('*').eq('menu_id', menu.id).eq('is_active', true).order('position'),
    supabase.from('products').select('*').eq('menu_id', menu.id).eq('is_available', true).order('position'),
  ])

  supabase.from('scan_events').insert({ tenant_id: tenant.id }).then(() => {})

  return <MenuPage tenant={tenant} categories={categories ?? []} products={products ?? []} menu={menu} initialLanguage={lang} />
}
