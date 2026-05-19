export const revalidate = 60

import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import MenuPage from '@/components/menu/MenuPage'
import BranchPicker from '@/components/menu/BranchPicker'
import ScanRecorder from '@/components/menu/ScanRecorder'
import type { Metadata } from 'next'
import type { ProductIngredientWithIngredient } from '@/types/database'
import { computePrimaryForeground } from '@/lib/color-utils'

interface Props {
  params: Promise<{ slug: string }>
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
  const { slug } = await params
  const tenant = await getTenantBySlug(slug)

  if (!tenant) return { title: 'Menu' }

  return {
    title: `Menu | ${tenant.name}`,
    description: `View the full menu of ${tenant.name}`,
    openGraph: {
      title: `Menu | ${tenant.name}`,
      images: [(tenant.tenant_settings as any)?.logo_url ?? ''],
    },
  }
}

export default async function PublicMenuPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { lang } = await searchParams

  const tenant = await getTenantBySlug(slug)
  if (!tenant) notFound()

  const supabase = createServiceClient()

  // LOC-03: check active locations — if ≥2 show branch picker
  const { data: activeLocations } = await supabase
    .from('locations')
    .select('id, name, slug, address, city, phone, business_hours')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if ((activeLocations ?? []).length >= 2) {
    const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#EEFF00'
    const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
    const { computePrimaryForeground } = await import('@/lib/color-utils')
    const primaryForeground = computePrimaryForeground(primaryColor)
    return (
      <>
        <style>{`:root{--primary:${primaryColor};--primary-foreground:${primaryForeground};--accent:${accentColor};}`}</style>
        <BranchPicker tenantName={tenant.name} tenantSlug={slug} locations={activeLocations!} />
      </>
    )
  }

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

  const ingredientCustomizationEnabled =
    (tenant.tenant_settings as any)?.ingredient_customization_enabled ?? false
  const productIds = products.map((p: any) => p.id)

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

  // P0-08 round 2: this page is `revalidate=60` ISR. A server-side insert
  // here would fire at most once per cache window. Scan recording is done
  // from the client via <ScanRecorder /> below so each visit is captured.

  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#EEFF00'
  const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
  const primaryForeground = computePrimaryForeground(primaryColor)

  return (
    <>
      <style>{`:root{--primary:${primaryColor};--primary-foreground:${primaryForeground};--accent:${accentColor};}`}</style>
      <ScanRecorder tenantId={tenant.id} />
      <MenuPage
        tenant={tenant}
        categories={categories}
        products={products}
        menu={resolvedMenu ?? null}
        initialLanguage={lang}
        ingredientCustomizationEnabled={ingredientCustomizationEnabled}
        productIngredientsByProductId={productIngredientsByProductId}
      />
    </>
  )
}
