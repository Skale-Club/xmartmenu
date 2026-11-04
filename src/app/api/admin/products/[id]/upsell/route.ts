import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { ownedCatalogEnabled } from '@/lib/data/admin-ingredients'
import { updateOwnedProductUpsellIds } from '@/lib/data/admin-product-upsell-runtime'
import { getTenantCapabilities } from '@/lib/tenant-plan'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!ownedCatalogEnabled()) return json({ error: 'Not found' }, 404)
  try {
    const effective = await getEffectiveTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    if (effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    const capabilities = await getTenantCapabilities(effective.tenantId)
    if (!capabilities.plan.payments) return json({ error: 'Product suggestions require the Payments plan' }, 403)
    const target = new URL(request.url)
    if (request.headers.get('origin') !== `${target.protocol}//${request.headers.get('host') ?? target.host}`) return json({ error: 'Origin mismatch' }, 403)
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'upsell_product_ids')) {
      return json({ error: 'Invalid product suggestions' }, 400)
    }
    return json(await updateOwnedProductUpsellIds({ tenantId: effective.tenantId, role: effective.role }, (await params).id, (body as { upsell_product_ids: unknown }).upsell_product_ids))
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid product suggestions' }, 400)
    if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
    return json({ error: 'Product suggestions are unavailable' }, 503)
  }
}
