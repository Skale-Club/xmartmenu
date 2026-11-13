import { BRAND_PRIMARY } from '@/lib/brand'
// Menu staging preview: the hidden staging copy of a menu, for the restaurant
// to review and approve before it is published (docs/product/menu-staging.md).
// Public for whoever holds the link, never indexed, never cached, browse-only.
export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import MenuPage from '@/components/menu/MenuPage'
import { sanitizeTenantForClient } from '@/lib/tenant-public'
import { withMenuPrices } from '@/lib/menu/public-menu-data'
import { loadStagingPreview } from '@/lib/menu/staging-preview'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'

interface Props {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ lang?: string; view?: string }>
}

export const metadata: Metadata = {
  title: 'Menu preview',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  referrer: 'no-referrer',
}

export default async function StagingPreviewPage({ params, searchParams }: Props) {
  const { slug, token } = await params
  const { lang, view } = await searchParams
  const data = await loadStagingPreview(slug, token)
  if (data.kind !== 'menu') notFound()

  const priced = withMenuPrices(data)
  const { tenant, menu, categories, products, capabilities } = priced
  /* eslint-disable @typescript-eslint/no-explicit-any -- tenant rows are untyped, as in the public pages */
  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? BRAND_PRIMARY
  const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const primaryForeground = computePrimaryForeground(primaryColor)

  return (
    <>
      <style>{`:root{--primary:${safeCssColor(primaryColor)};--primary-foreground:${primaryForeground};--accent:${safeCssColor(accentColor)};}`}</style>
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4"
      >
        <span className="rounded-full bg-amber-400/95 px-3 py-1 text-[12px] font-bold text-zinc-950 shadow-md">
          Preview · not live yet · ordering off
        </span>
      </div>
      <MenuPage
        tenant={sanitizeTenantForClient(tenant)}
        categories={categories}
        products={products}
        menu={menu ?? null}
        initialLanguage={lang}
        initialView={view === 'feed' || view === 'list' ? view : undefined}
        footerBrand={data.footerBrand}
        optionGroupsByProductId={priced.optionGroupsByProductId}
        productIngredientsByProductId={priced.productIngredientsByProductId}
        deliveryZones={[]}
        productMediaByProductId={data.productMediaByProductId}
        productArModelByProductId={data.productArModelByProductId}
        chatAddonEnabled={false}
        chatAddonAudioEnabled={false}
        chatAddonTextEnabled={false}
        capabilities={capabilities}
        table={null}
        waiterCallTable={null}
      />
    </>
  )
}
