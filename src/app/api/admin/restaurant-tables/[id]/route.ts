import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { ownedRestaurantTableItemHttp } from '@/lib/admin/owned-store-operations-http'

export const dynamic = 'force-dynamic'
const legacyPathOnly = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export const DELETE = withApi('DELETE /api/admin/restaurant-tables/[id]', (request: Request, context: { params: Promise<{ id: string }> }) =>
  adminMenusOwned()
    ? context.params.then(({ id }) => ownedRestaurantTableItemHttp(request, id))
    : Promise.resolve(legacyPathOnly()))
