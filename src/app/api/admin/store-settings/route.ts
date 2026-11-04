import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { ownedStoreSettingsHttp } from '@/lib/admin/owned-store-settings-http'

export const dynamic = 'force-dynamic'

export const PATCH = withApi('PATCH /api/admin/store-settings', (request: Request) =>
  adminMenusOwned()
    ? ownedStoreSettingsHttp(request)
    : Promise.resolve(NextResponse.json({ error: 'Not found' }, { status: 404 })))
