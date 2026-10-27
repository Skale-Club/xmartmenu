import { sanitizeTenantForClient } from '@/lib/tenant-public'
import { loadPublicMenuData, withMenuPrices } from '@/lib/menu/public-menu-data'
import { NextResponse } from 'next/server'

/**
 * GET — the restaurant's default menu as JSON. Same loader as the public
 * pages, so the same rules apply: inactive restaurants are not found, a
 * private menu has no content without a phone-verified session, and prices
 * carry the menu's multiplier.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const data = await loadPublicMenuData({ slug, tableId: null })
  if (data.kind === 'not_found') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (data.kind === 'branches') {
    return NextResponse.json({
      tenant: sanitizeTenantForClient(data.tenant),
      menu: null,
      categories: [],
      products: [],
      locations: data.locations,
    })
  }

  const priced = withMenuPrices(data)
  return NextResponse.json({
    tenant: sanitizeTenantForClient(priced.tenant),
    menu: priced.menu,
    categories: priced.categories,
    products: priced.products,
  })
}
