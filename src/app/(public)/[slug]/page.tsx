export const revalidate = 60

import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import MenuPage from '@/components/menu/MenuPage'
import BranchPicker from '@/components/menu/BranchPicker'
import ScanRecorder from '@/components/menu/ScanRecorder'
import JsonLdScript from '@/components/seo/JsonLdScript'
import type { Metadata } from 'next'
import type { ProductIngredientWithIngredient, ProductMedia } from '@/types/database'
import { computePrimaryForeground } from '@/lib/color-utils'
import { getCanonicalUrl, buildLocalBusinessJsonLd, buildMenuJsonLd } from '@/lib/seo'

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

  const settings = tenant.tenant_settings as any
  const title = tenant.name
  const description: string = settings?.tagline
    || settings?.about?.slice(0, 160)
    || `View the full menu of ${tenant.name}`
  const canonicalUrl = getCanonicalUrl(tenant, '/')
  const logoUrl: string | null = settings?.logo_url ?? settings?.banner_url ?? null
  const isCustomDomain = !!(tenant.custom_domain && tenant.custom_domain_verified)

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonicalUrl,
      siteName: tenant.name,
      ...(logoUrl ? { images: [{ url: logoUrl, alt: tenant.name }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(logoUrl ? { images: [logoUrl] } : {}),
    },
    ...(isCustomDomain ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function PublicMenuPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { lang } = await searchParams

  const tenant = await getTenantBySlug(slug)
  if (!tenant) notFound()

  const supabase = createServiceClient()

  // Phase 44: fetch platform footer brand
  const { data: platformRow } = await supabase.from('platform_settings').select('menu_footer_brand').single()
  const footerBrand = platformRow?.menu_footer_brand ?? 'XmartMenu'

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

  // P0-08 round 2: this page is `revalidate=60` ISR. A server-side insert
  // here would fire at most once per cache window. Scan recording is done
  // from the client via <ScanRecorder /> below so each visit is captured.

  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#EEFF00'
  const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
  const primaryForeground = computePrimaryForeground(primaryColor)
  const canonicalUrl = getCanonicalUrl(tenant, '/')
  const currency = (tenant.tenant_settings as any)?.currency ?? 'USD'

  const localBusinessLd = buildLocalBusinessJsonLd(tenant, tenant.tenant_settings as any, canonicalUrl)
  const menuLd = resolvedMenu
    ? buildMenuJsonLd(resolvedMenu.name, canonicalUrl, categories, products, currency)
    : null

  return (
    <>
      <style>{`:root{--primary:${primaryColor};--primary-foreground:${primaryForeground};--accent:${accentColor};}`}</style>
      <JsonLdScript data={localBusinessLd} />
      {menuLd && <JsonLdScript data={menuLd} />}
      <ScanRecorder tenantId={tenant.id} />
      <MenuPage
        tenant={tenant}
        categories={categories}
        products={products}
        menu={resolvedMenu ?? null}
        initialLanguage={lang}
        footerBrand={footerBrand}
        ingredientCustomizationEnabled={ingredientCustomizationEnabled}
        productIngredientsByProductId={productIngredientsByProductId}
        deliveryZones={(deliveryZones ?? []) as any}
        productMediaByProductId={productMediaByProductId}
        chatAddonEnabled={chatStatus.enabled}
        chatAddonAudioEnabled={!!chatSettings?.audio_enabled}
      />
    </>
  )
}
