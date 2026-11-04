import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { ownedRestaurantTableCollectionHttp } from '@/lib/admin/owned-store-operations-http'

export const dynamic = 'force-dynamic'
const legacyPathOnly = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export const GET = withApi('GET /api/admin/restaurant-tables', (request: Request) =>
  adminMenusOwned() ? ownedRestaurantTableCollectionHttp(request, 'list') : Promise.resolve(legacyPathOnly()))
export const POST = withApi('POST /api/admin/restaurant-tables', (request: Request) =>
  adminMenusOwned() ? ownedRestaurantTableCollectionHttp(request, 'create') : Promise.resolve(legacyPathOnly()))
export const PATCH = withApi('PATCH /api/admin/restaurant-tables', (request: Request) =>
  adminMenusOwned() ? ownedRestaurantTableCollectionHttp(request, 'reorder') : Promise.resolve(legacyPathOnly()))
