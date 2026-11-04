import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { ownedCatalogEnabled } from '@/lib/data/admin-ingredients'
import type { ProductMutation } from '@/lib/data/admin-products'
import { mutateOwnedProduct } from '@/lib/data/admin-products-runtime'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function ownedProductHttp(request: Request, kind: 'create' | 'patch' | 'delete', id?: string) {
  if (!ownedCatalogEnabled()) return json({ error: 'Not found' }, 404)
  try {
    const effective = await getEffectiveTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    if (effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    const target = new URL(request.url)
    if (request.headers.get('origin') !== `${target.protocol}//${request.headers.get('host') ?? target.host}`) return json({ error: 'Origin mismatch' }, 403)
    const mutation: ProductMutation = kind === 'create'
      ? { kind, body: await request.json(), selectedMenuId: (await cookies()).get('selected_menu_id')?.value }
      : kind === 'patch' ? { kind, id: id ?? '', body: await request.json() } : { kind, id: id ?? '' }
    return json(await mutateOwnedProduct({ tenantId: effective.tenantId, role: effective.role }, mutation), kind === 'create' ? 201 : 200)
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid product' }, 400)
    if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
    return json({ error: 'Product service is unavailable' }, 503)
  }
}
