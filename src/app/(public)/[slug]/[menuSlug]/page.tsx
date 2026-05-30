export const revalidate = 60

import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import MenuPage from '@/components/menu/MenuPage'
import ScanRecorder from '@/components/menu/ScanRecorder'
import PrivateMenuWrapper from '@/components/menu/PrivateMenuWrapper'
import type { Metadata } from 'next'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import type { ProductIngredientWithIngredient, ProductMedia } from '@/types/database'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import JsonLdScript from '@/components/seo/JsonLdScript'
import {
  getCanonicalUrl,
  buildLocalBusinessJsonLd,
  buildMenuJsonLd,
  buildBranchJsonLd,
  buildBreadcrumbJsonLd,
  buildSameAs,
  resolveSeoTitle,
  resolveSeoDescription,
  resolveSeoKeywords,
  resolveOgImageOverride,
  isTenantNoindex,
} from '@/lib/seo'

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
  const tenant = await getTenantBySlug(slug)
  if (!tenant) return { title: 'Menu' }
  const [{ data: loc }, { data: menu }] = await Promise.all([
    supabase.from('locations').select('name').eq('tenant_id', tenant.id).eq('slug', menuSlug).maybeSingle(),
    supabase.from('menus').select('name').eq('tenant_id', tenant.id).eq('slug', menuSlug).maybeSingle(),
  ])

  const sectionName = loc?.name ?? menu?.name ?? 'Menu'
  const settings = tenant.tenant_settings as any
  const title = resolveSeoTitle(tenant, settings, sectionName)
  const description = resolveSeoDescription(tenant, settings, `View the ${sectionName} menu`)
  const keywords = resolveSeoKeywords(settings)
  const canonicalPath = `/${menuSlug}`
  const canonicalUrl = getCanonicalUrl(tenant, canonicalPath)
  const ogOverride = resolveOgImageOverride(settings)
  const isCustomDomain = !!(tenant.custom_domain && tenant.custom_domain_verified)
  const noindex = isCustomDomain || isTenantNoindex(settings)

  return {
    title,
    description,
    metadataBase: new URL(canonicalUrl),
    ...(keywords.length ? { keywords } : {}),
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonicalUrl,
      siteName: tenant.name,
      ...(ogOverride ? { images: [{ url: ogOverride, alt: tenant.name }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(ogOverride ? { images: [ogOverride] } : {}),
    },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function PublicMenuSlugPage({ params, searchParams }: Props) {
  const { slug, menuSlug } = await params
  const { lang } = await searchParams
  const supabase = createServiceClient()

  const tenant = await getTenantBySlug(slug)
  if (!tenant) notFound()

  // Phase 44: fetch platform footer brand
  const { data: platformRow } = await supabase.from('platform_settings').select('menu_footer_brand').single()
  const footerBrand = platformRow?.menu_footer_brand ?? 'XmartMenu'

  // LOC-03: check if the second segment is a location slug first
  const [{ data: locationCandidate }, { data: menuCandidate }] = await Promise.all([
    supabase.from('locations').select('*').eq('tenant_id', tenant.id).eq('slug', menuSlug).eq('is_active', true).maybeSingle(),
    supabase.from('menus').select('*').eq('tenant_id', tenant.id).eq('slug', menuSlug).eq('is_active', true).maybeSingle(),
  ])

  // Resolve which branch/menu to use
  const location = locationCandidate ?? null
  let menu: typeof menuCandidate = null

  if (location) {
    // It's a location slug — resolve its menu (custom or shared default)
    if (location.menu_id) {
      const { data: customMenu } = await supabase
        .from('menus').select('*').eq('id', location.menu_id).eq('is_active', true).maybeSingle()
      menu = customMenu ?? null
    }
    if (!menu) {
      const { data: defaultMenu } = await supabase
        .from('menus').select('*').eq('tenant_id', tenant.id).eq('is_active', true).eq('is_default', true).maybeSingle()
      menu = defaultMenu ?? null
    }
    if (!menu) {
      const { data: fallbackMenu } = await supabase
        .from('menus').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('position').limit(1).maybeSingle()
      menu = fallbackMenu ?? null
    }
  } else if (menuCandidate) {
    menu = menuCandidate
  } else {
    notFound()
  }

  const [{ data: categories }, { data: products }] = await Promise.all([
    menu
      ? supabase.from('categories').select('*').eq('menu_id', menu.id).eq('is_active', true).order('position')
      : Promise.resolve({ data: [] }),
    menu
      ? supabase.from('products').select('*').eq('menu_id', menu.id).eq('is_available', true).order('position')
      : Promise.resolve({ data: [] }),
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

  // SEED-024: chat addon status for the widget
  const { getChatAddonStatus } = await import('@/lib/chat-addon')
  const chatStatus = await getChatAddonStatus(tenant.id)
  const { data: chatSettings } = chatStatus.enabled
    ? await supabase.from('chat_addon_settings').select('audio_enabled').eq('tenant_id', tenant.id).maybeSingle()
    : { data: null }

  // SEED-021: fetch product media for all products on this menu
  const productMediaByProductId: Record<string, ProductMedia[]> = {}
  if (productIds.length > 0) {
    const { data: rawMedia } = await supabase
      .from('product_media')
      .select('*')
      .in('product_id', productIds)
      .order('display_order')
    for (const m of rawMedia ?? []) {
      if (!productMediaByProductId[m.product_id]) productMediaByProductId[m.product_id] = []
      productMediaByProductId[m.product_id].push(m as ProductMedia)
    }
  }

  // Fetch active delivery zones for zone-based checkout pricing
  const deliveryEnabled = (tenant.tenant_settings as any)?.delivery_enabled ?? false
  const { data: deliveryZones } = deliveryEnabled
    ? await supabase.from('delivery_zones').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('created_at')
    : { data: [] }

  // P0-08 round 2: scan recording moved client-side via <ScanRecorder /> —
  // this page is ISR-cached so a server insert here only fires per cache miss.

  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#F52323'
  const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
  const primaryForeground = computePrimaryForeground(primaryColor)
  const canonicalPath = `/${menuSlug}`
  const canonicalUrl = getCanonicalUrl(tenant, canonicalPath)
  const currency = (tenant.tenant_settings as any)?.currency ?? 'USD'

  // SEED-019: apply price multiplier from private/in-store menu
  const priceMultiplier = (menu as any)?.price_multiplier ?? 1
  const displayProducts = priceMultiplier !== 1 && priceMultiplier > 0
    ? (products ?? []).map(p => ({ ...p, price: Math.round(p.price * priceMultiplier * 100) / 100 }))
    : (products ?? [])

  const isPrivate = (menu as any)?.is_private ?? false

  const parentUrl = getCanonicalUrl(tenant, '/')
  const tenantSettings = tenant.tenant_settings as any
  // SEO-08: when rendering a branch, use branch-specific LocalBusiness with branchOf.
  // Branches inherit price range and social profiles from the parent tenant.
  const localBusinessLd = location
    ? buildBranchJsonLd(location, canonicalUrl, parentUrl, {
        priceRange: tenantSettings?.price_range ?? null,
        sameAs: buildSameAs(tenantSettings),
      })
    : buildLocalBusinessJsonLd(tenant, tenantSettings, parentUrl)
  // Do not index private menus
  const menuLd = (menu && !isPrivate)
    ? buildMenuJsonLd(menu.name, canonicalUrl, categories ?? [], displayProducts, currency)
    : null
  // SEED-014: breadcrumb so this section nests under the tenant home in SERPs
  const sectionName = location?.name ?? menu?.name ?? 'Menu'
  const breadcrumbLd = !isPrivate
    ? buildBreadcrumbJsonLd([
        { name: tenant.name, url: parentUrl },
        { name: sectionName, url: canonicalUrl },
      ])
    : null

  const menuPageEl = (
    <MenuPage
      tenant={tenant}
      categories={categories ?? []}
      products={displayProducts}
      menu={menu}
      location={location ? { id: location.id, name: location.name } : null}
      initialLanguage={lang}
      footerBrand={footerBrand}
      optionGroupsByProductId={optionGroupsByProductId}
      ingredientCustomizationEnabled={ingredientCustomizationEnabled}
      productIngredientsByProductId={productIngredientsByProductId}
      deliveryZones={(deliveryZones ?? []) as any}
      productMediaByProductId={productMediaByProductId}
      chatAddonEnabled={chatStatus.enabled}
      chatAddonAudioEnabled={!!chatSettings?.audio_enabled}
    />
  )

  return (
    <>
      <style>{`:root{--primary:${safeCssColor(primaryColor)};--primary-foreground:${primaryForeground};--accent:${safeCssColor(accentColor)};}`}</style>
      <JsonLdScript data={localBusinessLd} />
      {menuLd && <JsonLdScript data={menuLd} />}
      {breadcrumbLd && <JsonLdScript data={breadcrumbLd} />}
      <ScanRecorder tenantId={tenant.id} />
      {isPrivate ? (
        <PrivateMenuWrapper slug={slug} menuSlug={menuSlug} primaryColor={primaryColor}>
          {menuPageEl}
        </PrivateMenuWrapper>
      ) : menuPageEl}
    </>
  )
}
