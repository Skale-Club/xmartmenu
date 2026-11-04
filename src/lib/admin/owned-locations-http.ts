import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { readOwnedDeliveryZones, readOwnedLocations, mutateOwnedDeliveryZone, mutateOwnedLocation } from '@/lib/data/admin-locations-runtime'
import type { DeliveryZoneMutation, LocationMutation } from '@/lib/data/admin-locations'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
function sameOrigin(request: Request) {
  const target = new URL(request.url)
  return request.headers.get('origin') === `${target.protocol}//${request.headers.get('host') ?? target.host}`
}
function errorResponse(error: unknown, label: string) {
  if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
  if (error instanceof SyntaxError) return json({ error: 'Invalid request body' }, 400)
  return json({ error: `${label} service is unavailable` }, 503)
}

export async function ownedLocationHttp(request: Request, kind: 'list' | 'create' | 'patch', id?: string) {
  try {
    const effective = await getEffectiveTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    if (kind === 'list') return json(await readOwnedLocations({ tenantId: effective.tenantId, role: effective.role }))
    if (effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    if (!sameOrigin(request)) return json({ error: 'Origin mismatch' }, 403)
    const mutation: LocationMutation = kind === 'create'
      ? { kind, body: await request.json() }
      : { kind: 'patch', id: id ?? '', body: await request.json() }
    return json(await mutateOwnedLocation({ tenantId: effective.tenantId, role: effective.role }, mutation), kind === 'create' ? 201 : 200)
  } catch (error) { return errorResponse(error, 'Location') }
}

export async function ownedDeliveryZoneHttp(request: Request, kind: 'list' | 'create' | 'patch' | 'delete', id?: string) {
  try {
    const effective = await getEffectiveTenant()
    if (!effective) return kind === 'list' || kind === 'create' ? json({ error: 'Unauthorized' }, 401) : json({ error: 'Not found' }, 404)
    if (kind === 'list') return json(await readOwnedDeliveryZones({ tenantId: effective.tenantId, role: effective.role }))
    if (effective.role === 'store-staff' && kind === 'create') return json({ error: 'Forbidden' }, 403)
    if (!sameOrigin(request)) return json({ error: 'Origin mismatch' }, 403)
    const mutation: DeliveryZoneMutation = kind === 'create'
      ? { kind, body: await request.json() }
      : kind === 'patch'
        ? { kind, id: id ?? '', body: await request.json() }
        : { kind: 'delete', id: id ?? '' }
    return json(await mutateOwnedDeliveryZone({ tenantId: effective.tenantId, role: effective.role }, mutation))
  } catch (error) { return errorResponse(error, 'Delivery zone') }
}
