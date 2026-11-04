export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { notFound } from 'next/navigation'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { ownedCatalogEnabled } from '@/lib/data/admin-ingredients'
import { readOwnedProductDetailPage } from '@/lib/data/admin-product-detail-runtime'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { cookies } from 'next/headers'
import { isShowcasePlan } from '@/components/admin/plan-views'
import type { ProductOptionGroup, ProductOption, Ingredient, ProductIngredient, Product } from '@/types/database'
import ProductDetailClient from './ProductDetailClient'
import type { UpsellCandidate } from './ProductUpsellCard'

export interface GroupWithOptions extends ProductOptionGroup {
  options: ProductOption[]
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const effective = await getEffectiveTenant()
  if (!effective) notFound()

  const tenantId = effective.tenantId
  const canManage = effective.role !== 'store-staff'
  if (ownedCatalogEnabled()) {
    const cookieStore = await cookies()
    const selectedMenuId = cookieStore.get('selected_menu_id')?.value
    const data = await readOwnedProductDetailPage({ tenantId, role: effective.role }, id, selectedMenuId).catch(error => {
      if (error instanceof AdminMenuError && error.status === 404) notFound()
      throw error
    })
    return (
      <ProductDetailClient
        product={data.product as Product & { category: { id: string; name: string } | null }}
        initialGroups={data.groups}
        tenantId={tenantId}
        currency={data.settings.currency}
        canManage={canManage}
        ingredientCustomizationEnabled={data.settings.ingredient_customization_enabled}
        allIngredients={data.ingredients}
        initialProductIngredients={data.productIngredients}
        baseLanguage={data.menu?.language ?? 'en'}
        supportedLanguages={data.menu?.supported_languages?.length ? data.menu.supported_languages : [data.menu?.language ?? 'en']}
        upsellCandidates={data.upsellCandidates}
        showcase={isShowcasePlan(data.plan)}
        upsellAvailable={data.plan.payments}
        ownedSource
      />
    )
  }

  const supabase = await createClient()

  const [{ data: product }, { data: groups }, { data: settings }, { data: ingredients }, { data: productIngredients }, capabilities] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:categories(id, name)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('product_option_groups')
      .select('*, options:product_options(*)')
      .eq('product_id', id)
      .order('position')
      .order('position', { referencedTable: 'product_options' }),
    supabase
      .from('tenant_settings')
      .select('custom_tags, currency, ingredient_customization_enabled')
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('ingredients')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('position'),
    supabase
      .from('product_ingredients')
      .select('*')
      .eq('product_id', id)
      .eq('tenant_id', tenantId),
    getTenantCapabilities(tenantId),
  ])

  if (!product) notFound()

  // Languages to translate into: the dish's own menu, else the menu being edited.
  const { data: ownMenu } = product.menu_id
    ? await supabase.from('menus').select('language, supported_languages').eq('id', product.menu_id).eq('tenant_id', tenantId).maybeSingle()
    : { data: null }
  const menu = ownMenu ?? await getActiveMenuForTenant(tenantId)
  const baseLanguage = menu?.language ?? 'en'
  const supportedLanguages = menu?.supported_languages?.length ? menu.supported_languages : [baseLanguage]

  // Other dishes on the same menu, to hand-pick for "Complete your order".
  let candidatesQuery = supabase
    .from('products')
    .select('id, name, category:categories(name)')
    .eq('tenant_id', tenantId)
    .neq('id', product.id)
    .order('position')
  if (product.menu_id) candidatesQuery = candidatesQuery.eq('menu_id', product.menu_id)
  const { data: candidateRows } = await candidatesQuery
  const upsellCandidates: UpsellCandidate[] = (candidateRows ?? []).map(row => {
    const category = row.category as { name?: string } | { name?: string }[] | null
    const categoryName = Array.isArray(category) ? category[0]?.name : category?.name
    return { id: row.id, name: row.name, category_name: categoryName ?? null }
  })

  return (
    <ProductDetailClient
      product={product}
      initialGroups={(groups ?? []) as GroupWithOptions[]}
      tenantId={tenantId}
      currency={settings?.currency ?? 'USD'}
      canManage={canManage}
      ingredientCustomizationEnabled={settings?.ingredient_customization_enabled ?? false}
      allIngredients={(ingredients ?? []) as Ingredient[]}
      initialProductIngredients={(productIngredients ?? []) as ProductIngredient[]}
      baseLanguage={baseLanguage}
      supportedLanguages={supportedLanguages}
      upsellCandidates={upsellCandidates}
      showcase={isShowcasePlan(capabilities.plan)}
      upsellAvailable={capabilities.plan.payments}
    />
  )
}
