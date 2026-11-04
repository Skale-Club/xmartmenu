import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { ownedQrCollectionHttp } from '@/lib/admin/owned-store-operations-http'

export const dynamic = 'force-dynamic'
const legacyPathOnly = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export const GET = withApi('GET /api/admin/qr-codes', (request: Request) =>
  adminMenusOwned() ? ownedQrCollectionHttp(request, 'list') : Promise.resolve(legacyPathOnly()))
export const POST = withApi('POST /api/admin/qr-codes', (request: Request) =>
  adminMenusOwned() ? ownedQrCollectionHttp(request, 'create') : Promise.resolve(legacyPathOnly()))
