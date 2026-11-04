import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { hasSameOriginAdminMutation } from '@/lib/data/admin-display-settings'
import { createOwnedQrCode, deleteOwnedQrCode, mutateOwnedRestaurantTable, readOwnedQrCodes, readOwnedRestaurantTables } from '@/lib/data/admin-store-operations-runtime'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

function errorResponse(error: unknown, label: string) {
  if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
  if (error instanceof SyntaxError) return json({ error: 'Invalid request body' }, 400)
  return json({ error: `${label} service is unavailable` }, 503)
}

async function currentTenant() {
  const effective = await getEffectiveTenant()
  if (!effective) return null
  return { tenantId: effective.tenantId, slug: effective.slug, role: effective.role }
}

function originAllowed(request: Request) {
  return hasSameOriginAdminMutation(request)
}

function baseUrlFor(request: Request) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  const target = new URL(request.url)
  const host = request.headers.get('host') ?? target.host
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`
}

export async function ownedQrCollectionHttp(request: Request, kind: 'list' | 'create') {
  try {
    const effective = await currentTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    const context = { tenantId: effective.tenantId, role: effective.role }
    if (kind === 'list') return json(await readOwnedQrCodes(context))
    if (!originAllowed(request)) return json({ error: 'Origin mismatch' }, 403)
    if (effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    const body = await request.json() as { label?: unknown }
    const label = body?.label
    if (typeof label !== 'string' || !label.trim()) return json({ error: 'A QR label is required' }, 400)
    const activeMenu = await getActiveMenuForTenant(effective.tenantId)
    const menuPath = `/${effective.slug}${activeMenu && !activeMenu.is_default ? `/${activeMenu.slug}` : ''}`
    const menuUrl = `${baseUrlFor(request)}${menuPath}`
    const targetUrl = `${menuUrl}?source=${encodeURIComponent(label)}`
    return json(await createOwnedQrCode(context, label, targetUrl), 201)
  } catch (error) { return errorResponse(error, 'QR code') }
}

export async function ownedQrItemHttp(request: Request, id: string) {
  try {
    const effective = await currentTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    if (!originAllowed(request)) return json({ error: 'Origin mismatch' }, 403)
    if (effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    return json(await deleteOwnedQrCode({ tenantId: effective.tenantId, role: effective.role }, id))
  } catch (error) { return errorResponse(error, 'QR code') }
}

export async function ownedRestaurantTableCollectionHttp(request: Request, kind: 'list' | 'create' | 'reorder') {
  try {
    const effective = await currentTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    const context = { tenantId: effective.tenantId, role: effective.role }
    if (kind === 'list') return json(await readOwnedRestaurantTables(context))
    if (!originAllowed(request)) return json({ error: 'Origin mismatch' }, 403)
    const body = await request.json() as Record<string, unknown>
    if (kind === 'create') {
      const table = await mutateOwnedRestaurantTable(context, { kind, name: body?.name })
      return json(table, 201)
    }
    if (typeof body?.firstId !== 'string' || typeof body?.secondId !== 'string') return json({ error: 'Invalid table order' }, 400)
    return json({ tables: await mutateOwnedRestaurantTable(context, { kind, firstId: body.firstId, secondId: body.secondId }) })
  } catch (error) { return errorResponse(error, 'Restaurant table') }
}

export async function ownedRestaurantTableItemHttp(request: Request, id: string) {
  try {
    const effective = await currentTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    if (!originAllowed(request)) return json({ error: 'Origin mismatch' }, 403)
    return json(await mutateOwnedRestaurantTable({ tenantId: effective.tenantId, role: effective.role }, { kind: 'delete', id }))
  } catch (error) { return errorResponse(error, 'Restaurant table') }
}
