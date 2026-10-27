export const revalidate = 60

import { notFound } from 'next/navigation'
import { sanitizeTenantForClient } from '@/lib/tenant-public'
import MenuPage from '@/components/menu/MenuPage'
import BranchPicker from '@/components/menu/BranchPicker'
import ScanRecorder from '@/components/menu/ScanRecorder'
import JsonLdScript from '@/components/seo/JsonLdScript'
import type { Metadata } from 'next'
import { getTenantBySlug, loadPublicMenuData, withMenuPrices } from '@/lib/menu/public-menu-data'
import PrivateMenuWrapper from '@/components/menu/PrivateMenuWrapper'
import { parseTableParam } from '@/lib/service-modes'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import {
  getCanonicalUrl,
  buildLocalBusinessJsonLd,
  buildMenuJsonLd,
  resolveSeoTitle,
  resolveSeoDescription,
  resolveSeoKeywords,
  resolveOgImageOverride,
  isTenantNoindex,
} from '@/lib/seo'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string; view?: string; table?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const tenant = await getTenantBySlug(slug)

  if (!tenant) return { title: 'Menu' }

  const settings = tenant.tenant_settings as any
  const title = resolveSeoTitle(tenant, settings)
  const description = resolveSeoDescription(tenant, settings)
  const keywords = resolveSeoKeywords(settings)
  const canonicalUrl = getCanonicalUrl(tenant, '/')
  const ogOverride = resolveOgImageOverride(settings)
  // On the platform-slug URL we suppress indexing when a custom domain is the
  // canonical home; a tenant can also opt out of indexing entirely.
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
      // When no override is set, the branded opengraph-image.tsx route supplies the image.
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

export default async function PublicMenuPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { lang, view, table: tableParam } = await searchParams

  // All queries in four parallel stages (src/lib/menu/public-menu-data.ts).
  const data = await loadPublicMenuData({
    slug,
    // The table this link belongs to (QR code / NFC tag: ?table=<id>): guests
    // order to it, or call a waiter / ask for the bill from it.
    tableId: parseTableParam(tableParam),
  })
  if (data.kind === 'not_found') notFound()

  const { tenant } = data

  // LOC-03: 2+ active locations → branch picker
  if (data.kind === 'branches') {
    const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#F52323'
    const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
    const primaryForeground = computePrimaryForeground(primaryColor)
    return (
      <>
        <style>{`:root{--primary:${safeCssColor(primaryColor)};--primary-foreground:${primaryForeground};--accent:${safeCssColor(accentColor)};}`}</style>
        <BranchPicker
          tenantName={tenant.name}
          tenantSlug={slug}
          locations={data.locations}
          initialView={view === 'feed' ? 'feed' : 'list'}
        />
      </>
    )
  }

  // Same prices and the same private-menu rule as /[slug]/[menuSlug]: the
  // default menu can be private or carry an in-store multiplier too.
  const priced = withMenuPrices(data)
  const { menu: resolvedMenu, categories, products, capabilities, table } = priced
  const isPrivate = resolvedMenu?.is_private === true

  // P0-08 round 2: this page is `revalidate=60` ISR. A server-side insert
  // here would fire at most once per cache window. Scan recording is done
  // from the client via <ScanRecorder /> below so each visit is captured.

  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#F52323'
  const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
  const primaryForeground = computePrimaryForeground(primaryColor)
  const canonicalUrl = getCanonicalUrl(tenant, '/')
  const currency = (tenant.tenant_settings as any)?.currency ?? 'USD'

  const localBusinessLd = buildLocalBusinessJsonLd(tenant, tenant.tenant_settings as any, canonicalUrl)
  const menuLd = resolvedMenu && !isPrivate
    ? buildMenuJsonLd(resolvedMenu.name, canonicalUrl, categories, products, currency)
    : null

  const menuPageEl = (
    <MenuPage
      tenant={sanitizeTenantForClient(tenant)}
      categories={categories}
      products={products}
      menu={resolvedMenu ?? null}
      initialLanguage={lang}
      initialView={view === 'feed' || view === 'list' ? view : undefined}
      footerBrand={data.footerBrand}
      optionGroupsByProductId={priced.optionGroupsByProductId}
      productIngredientsByProductId={priced.productIngredientsByProductId}
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
      <ScanRecorder tenantId={tenant.id} />
      {isPrivate ? (
        <PrivateMenuWrapper slug={slug} menuSlug={resolvedMenu.slug ?? ""} primaryColor={primaryColor} serverAuthed={data.privateAccess}>
          {data.privateAccess ? menuPageEl : null}
        </PrivateMenuWrapper>
      ) : menuPageEl}
    </>
  )
}
