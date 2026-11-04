import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { ownedCatalogEnabled } from '@/lib/data/admin-ingredients'
import { detailOperation } from '@/lib/data/admin-product-detail'
import { mutateOwnedProductDetail } from '@/lib/data/admin-product-detail-runtime'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function ownedProductDetailHttp(request: Request, id: string) {
  if (!ownedCatalogEnabled()) return json({ error: 'Not found' }, 404)
  try {
    const effective = await getEffectiveTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    const target = new URL(request.url)
    if (request.headers.get('origin') !== `${target.protocol}//${request.headers.get('host') ?? target.host}`) return json({ error: 'Origin mismatch' }, 403)
    const operation = detailOperation(await request.json())
    if (operation.action !== 'list' && effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    return json(await mutateOwnedProductDetail({ tenantId: effective.tenantId, role: effective.role }, id, operation))
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid product configuration' }, 400)
    if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
    return json({ error: 'Product configuration is unavailable' }, 503)
  }
}
