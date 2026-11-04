import type { DeliveryZone, Location, UserRole } from '@/types/database'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { planCeiling } from '../service-modes'

export type AdminLocationContext = { tenantId: string; role: UserRole }
export type LocationMutation =
  | { kind: 'create'; body: unknown }
  | { kind: 'patch'; id: string; body: unknown }
export type DeliveryZoneMutation =
  | { kind: 'create'; body: unknown }
  | { kind: 'patch'; id: string; body: unknown }
  | { kind: 'delete'; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOCATION_COLUMNS = 'id tenant_id name slug address city phone business_hours region postal_code country latitude longitude menu_id is_active created_at updated_at'
const MENU_COLUMNS = 'id name slug is_default'
const ZONE_COLUMNS = 'id tenant_id name fee_cents zipcode_prefixes is_active created_at updated_at'

function scope(context: AdminLocationContext, write = false) {
  if (!UUID.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')
  if (write && context.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminMenuError(400, 'Invalid request body')
  return value as Record<string, unknown>
}
function projection(alias: string, columns: string) {
  return `to_jsonb((SELECT projected FROM (SELECT ${columns.split(' ').map(column => `${alias}.${column}`).join(', ')}) projected))`
}
function records<T>(rows: Record<string, unknown>[], label: string, limit = 1000): T[] {
  if (rows.length > limit) throw new AdminMenuError(409, `${label} exceeds the supported limit`)
  return rows.map(value => {
    if (!value.row || typeof value.row !== 'object' || Array.isArray(value.row)) throw new Error(`Invalid ${label} record`)
    return value.row as T
  })
}

export async function readAdminLocationsPage(query: AdminMenuQuery, context: AdminLocationContext) {
  scope(context)
  const [locations, menus, tenant] = await Promise.all([
    query(`SELECT ${projection('l', LOCATION_COLUMNS)} AS row FROM public.locations l WHERE l.tenant_id=$1 ORDER BY l.created_at,l.id LIMIT 1001`, [context.tenantId]),
    query(`SELECT ${projection('m', MENU_COLUMNS)} AS row FROM public.menus m WHERE m.tenant_id=$1 AND m.is_active=true ORDER BY m.position,m.id LIMIT 1001`, [context.tenantId]),
    query('SELECT slug FROM public.tenants WHERE id=$1 LIMIT 1', [context.tenantId]),
  ])
  if (!tenant.rows[0] || typeof tenant.rows[0].slug !== 'string') throw new AdminMenuError(404, 'Tenant not found')
  return {
    locations: records<Location>(locations.rows, 'Locations'),
    menus: records<{ id: string; name: string; slug: string; is_default: boolean }>(menus.rows, 'Menus'),
    tenantSlug: tenant.rows[0].slug,
  }
}

export async function readAdminLocations(query: AdminMenuQuery, context: AdminLocationContext) {
  scope(context)
  return records<Location>((await query(`SELECT ${projection('l', LOCATION_COLUMNS)} AS row FROM public.locations l
    WHERE l.tenant_id=$1 ORDER BY l.created_at,l.id LIMIT 1001`, [context.tenantId])).rows, 'Locations')
}

async function findMenu(query: AdminMenuQuery, tenantId: string, menuId: unknown, lock = false) {
  if (typeof menuId !== 'string' || !UUID.test(menuId)) return null
  return (await query(`SELECT id FROM public.menus WHERE tenant_id=$1 AND id=$2 LIMIT 1${lock ? ' FOR SHARE' : ''}`, [tenantId, menuId])).rows[0] ?? null
}

function duplicateLocation(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new AdminMenuError(409, 'A location with this slug already exists')
  throw error
}

function locationCreate(value: unknown) {
  const body = object(value)
  if (typeof body.name !== 'string' || !body.name.trim()) throw new AdminMenuError(400, 'Name is required')
  if (typeof body.slug !== 'string' || !body.slug.trim()) throw new AdminMenuError(400, 'Slug is required')
  if (!/^[a-z0-9-]+$/.test(body.slug)) throw new AdminMenuError(400, 'Slug must be lowercase letters, numbers, and hyphens only')
  const coord = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    name: body.name.trim(), slug: body.slug.trim(),
    address: typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null,
    city: typeof body.city === 'string' && body.city.trim() ? body.city.trim() : null,
    phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
    business_hours: body.business_hours || null,
    region: typeof body.region === 'string' && body.region.trim() ? body.region.trim() : null,
    postal_code: typeof body.postal_code === 'string' && body.postal_code.trim() ? body.postal_code.trim() : null,
    country: typeof body.country === 'string' && body.country.trim() ? body.country.trim() : null,
    latitude: coord(body.latitude), longitude: coord(body.longitude),
    menu_id: body.menu_id || null,
  }
}

function locationPatch(value: unknown) {
  const body = object(value)
  const allowed = ['name', 'slug', 'address', 'city', 'phone', 'business_hours', 'is_active', 'menu_id', 'region', 'postal_code', 'country', 'latitude', 'longitude']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  if (!Object.keys(update).length) throw new AdminMenuError(400, 'Invalid location')
  for (const key of ['latitude', 'longitude'] as const) if (key in update) {
    const value = update[key]
    update[key] = typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  for (const key of ['name', 'slug', 'address', 'city', 'phone', 'region', 'postal_code', 'country'] as const) {
    if (key in update && update[key] !== null && typeof update[key] !== 'string') throw new AdminMenuError(400, `Invalid ${key}`)
  }
  if ('is_active' in update && typeof update.is_active !== 'boolean') throw new AdminMenuError(400, 'Invalid location status')
  if ('business_hours' in update && update.business_hours !== null && (typeof update.business_hours !== 'object' || Array.isArray(update.business_hours))) {
    throw new AdminMenuError(400, 'Invalid business hours')
  }
  if (update.slug && (typeof update.slug !== 'string' || !/^[a-z0-9-]+$/.test(update.slug))) throw new AdminMenuError(400, 'Slug must be lowercase letters, numbers, and hyphens only')
  return update
}

async function validateMenu(query: AdminMenuQuery, context: AdminLocationContext, menuId: unknown) {
  if (menuId === null || menuId === undefined || menuId === '') return null
  if (typeof menuId !== 'string' || !await findMenu(query, context.tenantId, menuId, true)) throw new AdminMenuError(400, 'Menu not found for this tenant')
  return menuId
}

export async function mutateAdminLocation(query: AdminMenuQuery, context: AdminLocationContext, mutation: LocationMutation): Promise<Location> {
  scope(context, true)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-locations:${context.tenantId}`])
  if (mutation.kind === 'create') {
    const values = locationCreate(mutation.body)
    values.menu_id = await validateMenu(query, context, values.menu_id)
    const fields = Object.keys(values)
    try {
      const result = await query(`INSERT INTO public.locations AS l (tenant_id,${fields.join(',')})
        VALUES ($1,${fields.map((_, index) => `$${index + 2}`).join(',')}) RETURNING ${projection('l', LOCATION_COLUMNS)} AS row`,
      [context.tenantId, ...fields.map(field => values[field as keyof typeof values])])
      return records<Location>(result.rows, 'Locations')[0]!
    } catch (error) { duplicateLocation(error) }
  }

  if (!UUID.test(mutation.id)) throw new AdminMenuError(404, 'Not found')
  const current = await query(`SELECT id FROM public.locations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [context.tenantId, mutation.id])
  if (!current.rows.length) throw new AdminMenuError(404, 'Not found')
  const update = locationPatch(mutation.body)
  if ('menu_id' in update) update.menu_id = await validateMenu(query, context, update.menu_id)
  const fields = Object.keys(update)
  try {
    const result = await query(`UPDATE public.locations l SET ${fields.map((field, index) => `${field}=$${index + 3}`).join(', ')}
      WHERE l.tenant_id=$1 AND l.id=$2 RETURNING ${projection('l', LOCATION_COLUMNS)} AS row`,
    [context.tenantId, mutation.id, ...fields.map(field => update[field])])
    const location = records<Location>(result.rows, 'Locations')[0]
    if (!location) throw new AdminMenuError(404, 'Not found')
    return location
  } catch (error) { duplicateLocation(error) }
}

async function paymentsEntitlement(query: AdminMenuQuery, tenantId: string, lock = false) {
  const result = await query(`SELECT s.status,p.features FROM public.tenant_subscriptions s JOIN public.plans p ON p.id=s.plan_id
    WHERE s.tenant_id=$1 LIMIT 2${lock ? ' FOR SHARE OF s,p' : ''}`, [tenantId])
  if (result.rows.length > 1) throw new AdminMenuError(503, 'Plan information is unavailable')
  const row = result.rows[0]
  if (!row || !['active', 'trial'].includes(String(row.status))) return false
  if (!Array.isArray(row.features) || row.features.some(feature => typeof feature !== 'string')) throw new AdminMenuError(503, 'Plan information is unavailable')
  return planCeiling(row.features).payments
}

function zoneBody(value: unknown, partial: boolean) {
  const body = object(value)
  const update: Record<string, unknown> = {}
  if (!partial || 'name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new AdminMenuError(400, partial ? 'Invalid zone name' : 'Zone name is required')
    update.name = body.name.trim()
  }
  if (!partial || 'fee_cents' in body) {
    const fee = Math.max(0, Number(body.fee_cents ?? 0))
    if (!Number.isSafeInteger(fee)) throw new AdminMenuError(400, 'Invalid delivery fee')
    update.fee_cents = fee
  }
  if (!partial || 'zipcode_prefixes' in body) {
    const prefixes = body.zipcode_prefixes
    if (prefixes !== undefined && !Array.isArray(prefixes)) throw new AdminMenuError(400, 'Invalid zipcode prefixes')
    if (Array.isArray(prefixes) && prefixes.some(prefix => typeof prefix !== 'string')) throw new AdminMenuError(400, 'Invalid zipcode prefixes')
    update.zipcode_prefixes = Array.isArray(prefixes) ? prefixes : []
  }
  if (partial && 'is_active' in body) {
    if (typeof body.is_active !== 'boolean') throw new AdminMenuError(400, 'Invalid zone status')
    update.is_active = body.is_active
  }
  if (partial && !Object.keys(update).length) throw new AdminMenuError(400, 'Invalid delivery zone')
  return update
}

export async function readAdminDeliveryZones(query: AdminMenuQuery, context: AdminLocationContext) {
  scope(context)
  return records<DeliveryZone>((await query(`SELECT ${projection('z', ZONE_COLUMNS)} AS row FROM public.delivery_zones z
    WHERE z.tenant_id=$1 ORDER BY z.created_at,z.id LIMIT 1001`, [context.tenantId])).rows, 'Delivery zones')
}

export async function mutateAdminDeliveryZone(query: AdminMenuQuery, context: AdminLocationContext, mutation: DeliveryZoneMutation): Promise<DeliveryZone | { ok: true }> {
  scope(context, mutation.kind === 'create')
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-delivery-zones:${context.tenantId}`])
  let current: Record<string, unknown> | undefined
  if (mutation.kind !== 'create') {
    if (!UUID.test(mutation.id)) throw new AdminMenuError(404, 'Not found')
    current = (await query(`SELECT id,tenant_id FROM public.delivery_zones WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [context.tenantId, mutation.id])).rows[0]
    if (!current) throw new AdminMenuError(404, 'Not found')
  }
  scope(context, true)
  const permitted = await paymentsEntitlement(query, context.tenantId, true)
  if (!permitted) throw new AdminMenuError(403, 'Delivery zones are part of the Menu + Payments plan')

  if (mutation.kind === 'delete') {
    const foreignReference = await query('SELECT id FROM public.orders WHERE delivery_zone_id=$1 AND tenant_id<>$2 ORDER BY id LIMIT 1 FOR UPDATE', [mutation.id, context.tenantId])
    if (foreignReference.rows.length) throw new AdminMenuError(409, 'Delivery zone has inconsistent tenant references')
    await query('DELETE FROM public.delivery_zones WHERE tenant_id=$1 AND id=$2', [context.tenantId, mutation.id])
    return { ok: true }
  }

  const values = zoneBody(mutation.body, mutation.kind === 'patch')
  const fields = Object.keys(values)
  if (mutation.kind === 'create') {
    const result = await query(`INSERT INTO public.delivery_zones AS z (tenant_id,${fields.join(',')})
      VALUES ($1,${fields.map((_, index) => `$${index + 2}`).join(',')}) RETURNING ${projection('z', ZONE_COLUMNS)} AS row`,
    [context.tenantId, ...fields.map(field => values[field])])
    return records<DeliveryZone>(result.rows, 'Delivery zones')[0]!
  }
  const result = await query(`UPDATE public.delivery_zones z SET ${fields.map((field, index) => `${field}=$${index + 3}`).join(', ')}
    WHERE z.tenant_id=$1 AND z.id=$2 RETURNING ${projection('z', ZONE_COLUMNS)} AS row`,
  [context.tenantId, mutation.id, ...fields.map(field => values[field])])
  const zone = records<DeliveryZone>(result.rows, 'Delivery zones')[0]
  if (!zone) throw new AdminMenuError(404, 'Not found')
  return zone
}
