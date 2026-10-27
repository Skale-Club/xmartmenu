export const revalidate = 60

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sanitizeTenantForClient } from '@/lib/tenant-public'
import MenuPage from '@/components/menu/MenuPage'
import ScanRecorder from '@/components/menu/ScanRecorder'
import PrivateMenuWrapper from '@/components/menu/PrivateMenuWrapper'
import type { Metadata } from 'next'
import { getPublicMenuBase, loadPublicMenuData } from '@/lib/menu/public-menu-data'
import { parseTableParam } from '@/lib/service-modes'
import { effectiveMultiplier, scaleOptionGroups, scaleProductIngredients, scaleProducts } from '@/components/menu/price-multiplier'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import type { ProductIngredientWithIngredient } from '@/types/database'
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
  searchParams: Promise<{ lang?: string; view?: string; table?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, menuSlug } = await params
  // Same cached read the page makes (deduplicated per request).
  const base = await getPublicMenuBase(slug, menuSlug)
  if (base.kind === 'not_found') return { title: 'Menu' }
  const tenant = base.tenant

  const sectionName = (base.kind === 'menu' ? base.location?.name ?? base.menu?.name : null) ?? 'Menu'
  const settings = tenant.tenant_settings as any
  const title = resolveSeoTitle(tenant, settings, sectionName)
  const description = resolveSeoDescription(tenant, settings, `View the ${sectionName} menu`)
  const keywords = resolveSeoKeywords(settings)
  const canonicalPath = `/${menuSlug}`
  const canonicalUrl = getCanonicalUrl(tenant, canonicalPath)
  const ogOverride = resolveOgImageOverride(settings)
  // Indexing follows the restaurant's own preference. A verified custom domain
  // is the canonical URL (getCanonicalUrl), and the platform-slug copy points
  // to it; noindex-ing every page of a tenant with a custom domain de-indexed
  // the canonical site itself.
  const noindex = isTenantNoindex(settings)

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
  const { lang, view, table: tableParam } = await searchParams

  // All queries in four parallel stages (src/lib/menu/public-menu-data.ts).
  // LOC-03: the second segment is a location slug first, else a menu slug.
  const data = await loadPublicMenuData({
    slug,
    menuSlug,
    // The table this link belongs to (QR code / NFC tag: ?table=<id>): guests
    // order to it, or call a waiter / ask for the bill from it.
    tableId: parseTableParam(tableParam),
    // Private menus gate on a phone-verified session (see below). Checked in
    // parallel with the menu queries, only when the menu is private.
    checkPrivateAccess: async () => {
      const cookieClient = await createClient()
      const { data: { user } } = await cookieClient.auth.getUser()
      return !!user?.phone
    },
  })
  if (data.kind !== 'menu') notFound()

  const { tenant, menu, location, categories, products, capabilities, table } = data

  // SEED-019: a private/in-store menu scales every price on it the same way.
  const priceMultiplier = effectiveMultiplier((menu as any)?.price_multiplier)
  const optionGroupsByProductId: Record<string, GroupWithOptions[]> = {}
  for (const [productId, groups] of Object.entries(data.optionGroupsByProductId)) {
    optionGroupsByProductId[productId] = scaleOptionGroups(groups, priceMultiplier)
  }
  const productIngredientsByProductId: Record<string, ProductIngredientWithIngredient[]> = {}
  for (const [productId, items] of Object.entries(data.productIngredientsByProductId)) {
    productIngredientsByProductId[productId] = scaleProductIngredients(items, priceMultiplier)
  }

  // P0-08 round 2: scan recording moved client-side via <ScanRecorder /> —
  // this page is ISR-cached so a server insert here only fires per cache miss.

  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#F52323'
  const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
  const primaryForeground = computePrimaryForeground(primaryColor)
  const canonicalPath = `/${menuSlug}`
  const canonicalUrl = getCanonicalUrl(tenant, canonicalPath)
  const currency = (tenant.tenant_settings as any)?.currency ?? 'USD'

  // SEED-019: dish prices on a private/in-store menu (options and ingredients scaled above).
  const displayProducts = scaleProducts(products ?? [], priceMultiplier)

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

  // Private menus gate on a phone-verified session. This MUST be enforced
  // server-side: an ISR/RSC page serializes a client component's children into
  // the payload regardless of any client-side lock, so rendering the menu and
  // hiding it with a client overlay leaks the full "exclusive" menu + in-store
  // pricing to anyone who reads the response. When the caller is not
  // authenticated we render ONLY the lock screen and never build the menu.
  // The session check ran in loadPublicMenuData (checkPrivateAccess).
  const privateAuthed = isPrivate && data.privateAccess

  const menuPageEl = (
    <MenuPage
      tenant={sanitizeTenantForClient(tenant)}
      categories={categories ?? []}
      products={displayProducts}
      menu={menu}
      location={location ? { id: location.id, name: location.name } : null}
      initialLanguage={lang}
      initialView={view === 'feed' || view === 'list' ? view : undefined}
      footerBrand={data.footerBrand}
      optionGroupsByProductId={optionGroupsByProductId}
      productIngredientsByProductId={productIngredientsByProductId}
      deliveryZones={data.deliveryZones}
      productMediaByProductId={data.productMediaByProductId}
      chatAddonEnabled={data.chatAddonEnabled}
      chatAddonAudioEnabled={data.chatAddonAudioEnabled}
      chatAddonTextEnabled={data.chatAddonTextEnabled}
      capabilities={capabilities}
      table={capabilities.guestOrdering ? table : null}
      waiterCallTable={capabilities.waiterCalls ? table : null}
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
        <PrivateMenuWrapper slug={slug} menuSlug={menuSlug} primaryColor={primaryColor} serverAuthed={privateAuthed}>
          {privateAuthed ? menuPageEl : null}
        </PrivateMenuWrapper>
      ) : menuPageEl}
    </>
  )
}
