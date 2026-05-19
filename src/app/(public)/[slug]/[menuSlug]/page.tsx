export const revalidate = 60

import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import MenuPage from '@/components/menu/MenuPage'
import ScanRecorder from '@/components/menu/ScanRecorder'
import type { Metadata } from 'next'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import type { ProductIngredientWithIngredient } from '@/types/database'
import { computePrimaryForeground } from '@/lib/color-utils'

interface Props {
  params: Promise<{ slug: string; menuSlug: string }>
  searchParams: Promise<{ lang?: string }>
}

const getTenantBySlug = cache(async (slug: string) => {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('*, tenant_settings(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()
  return data
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, menuSlug } = await params
  const supabase = createServiceClient()
  const [tenant, { data: menu }] = await Promise.all([
    getTenantBySlug(slug),
    supabase.from('menus').select('name').eq('slug', menuSlug).single(),
  ])
  if (!tenant) return { title: 'Menu' }
  return { title: `${menu?.name ?? 'Menu'} | ${tenant.name}` }
}

export default async function PublicMenuSlugPage({ params, searchParams }: Props) {
  const { slug, menuSlug } = await params
  const { lang } = await searchParams
  const supabase = createServiceClient()

  const [tenant, { data: menuCandidate }] = await Promise.all([
    getTenantBySlug(slug),
    supabase.from('menus').select('*').eq('slug', menuSlug).eq('is_active', true).single(),
  ])

  if (!tenant || !menuCandidate || menuCandidate.tenant_id !== tenant.id) notFound()
  const menu = menuCandidate

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from('categories').select('*').eq('menu_id', menu.id).eq('is_active', true).order('position'),
    supabase.from('products').select('*').eq('menu_id', menu.id).eq('is_available', true).order('position'),
  ])

  const directOrdersEnabled = tenant.tenant_settings?.direct_orders_enabled ?? false
  const productIds = (products ?? []).map(p => p.id)

  const optionGroupsByProductId: Record<string, GroupWithOptions[]> = {}
  if (directOrdersEnabled && productIds.length > 0) {
    const { data: rawGroups } = await supabase
      .from('product_option_groups')
      .select('*, options:product_options(*)')
      .in('product_id', productIds)
      .order('position')
      .order('position', { referencedTable: 'product_options' })

    for (const group of rawGroups ?? []) {
      const filtered: GroupWithOptions = {
        ...group,
        options: (group.options as GroupWithOptions['options']).filter(o => o.is_available),
      }
      if (!optionGroupsByProductId[group.product_id]) {
        optionGroupsByProductId[group.product_id] = []
      }
      optionGroupsByProductId[group.product_id].push(filtered)
    }
  }

  const ingredientCustomizationEnabled =
    tenant.tenant_settings?.ingredient_customization_enabled ?? false

  const productIngredientsByProductId: Record<string, ProductIngredientWithIngredient[]> = {}
  if (ingredientCustomizationEnabled && productIds.length > 0) {
    const { data: rawPIs } = await supabase
      .from('product_ingredients')
      .select('*, ingredient:ingredients(*)')
      .in('product_id', productIds)
      .order('position')

    for (const pi of rawPIs ?? []) {
      if (!productIngredientsByProductId[pi.product_id]) {
        productIngredientsByProductId[pi.product_id] = []
      }
      productIngredientsByProductId[pi.product_id].push(pi as ProductIngredientWithIngredient)
    }
  }

  // P0-08 round 2: scan recording moved client-side via <ScanRecorder /> —
  // this page is ISR-cached so a server insert here only fires per cache miss.

  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#EEFF00'
  const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
  const primaryForeground = computePrimaryForeground(primaryColor)

  return (
    <>
      <style>{`:root{--primary:${primaryColor};--primary-foreground:${primaryForeground};--accent:${accentColor};}`}</style>
      <ScanRecorder tenantId={tenant.id} />
      <MenuPage
        tenant={tenant}
        categories={categories ?? []}
        products={products ?? []}
        menu={menu}
        initialLanguage={lang}
        optionGroupsByProductId={optionGroupsByProductId}
        ingredientCustomizationEnabled={ingredientCustomizationEnabled}
        productIngredientsByProductId={productIngredientsByProductId}
      />
    </>
  )
}
