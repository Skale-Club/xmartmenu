import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { mutateAdminDeliveryZone, mutateAdminLocation, readAdminLocationsPage } from '@/lib/data/admin-locations'

const tenantId = randomUUID(), menuId = randomUUID(), locationId = randomUUID(), zoneId = randomUUID()
const context = { tenantId, role: 'store-admin' as const }
const location = { id: locationId, tenant_id: tenantId, name: 'Downtown', slug: 'downtown', menu_id: menuId }
const zone = { id: zoneId, tenant_id: tenantId, name: 'Central', fee_cents: 450, zipcode_prefixes: ['100'], is_active: true }

describe('owned location repositories', () => {
  it('reads locations, active menus and tenant slug with explicit tenant scopes', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values
      if (sql.includes('FROM public.locations')) return { rows: [{ row: location }] }
      if (sql.includes('FROM public.menus')) return { rows: [{ row: { id: menuId, name: 'Main', slug: 'main', is_default: true } }] }
      return { rows: [{ slug: 'restaurant' }] }
    })
    await expect(readAdminLocationsPage(query, { ...context, role: 'store-staff' })).resolves.toEqual({
      locations: [location], menus: [{ id: menuId, name: 'Main', slug: 'main', is_default: true }], tenantSlug: 'restaurant',
    })
    for (const call of query.mock.calls) expect(call[1]).toEqual([tenantId])
  })

  it('creates locations with server tenant, whitelisted fields, and a locked own menu', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM public.menus')) return { rows: [{ id: menuId }] }
      if (sql.includes('INSERT INTO public.locations')) return { rows: [{ row: { ...location, address: '1 Main', latitude: -23.5 } }] }
      void values
      return { rows: [] }
    })
    await expect(mutateAdminLocation(query, context, { kind: 'create', body: {
      id: randomUUID(), tenant_id: randomUUID(), name: ' Downtown ', slug: 'downtown', address: ' 1 Main ', menu_id: menuId, latitude: -23.5,
    } })).resolves.toMatchObject({ tenant_id: tenantId, address: '1 Main', latitude: -23.5 })
    expect(query.mock.calls[1]?.[0]).toContain('FOR SHARE')
    const [insert, values] = query.mock.calls[2]!
    expect(insert).toContain('INSERT INTO public.locations AS l (tenant_id,name,slug,address,city,phone,business_hours,region,postal_code,country,latitude,longitude,menu_id)')
    expect(values?.[0]).toBe(tenantId)
    expect(values).not.toContain(randomUUID())
  })

  it('rejects a foreign menu and translates duplicate slugs without writing across tenants', async () => {
    const foreignMenuQuery = vi.fn(async (sql: string) => sql.includes('FROM public.menus') ? { rows: [] } : { rows: [] })
    await expect(mutateAdminLocation(foreignMenuQuery, context, { kind: 'create', body: { name: 'Branch', slug: 'branch', menu_id: menuId } })).rejects.toMatchObject({ status: 400 })
    const invalidMenuQuery = vi.fn(async (sql: string) => sql.includes('FROM public.locations') ? { rows: [{ id: locationId }] } : { rows: [] })
    await expect(mutateAdminLocation(invalidMenuQuery, context, { kind: 'patch', id: locationId, body: { menu_id: 42 } })).rejects.toMatchObject({ status: 400 })
    expect(foreignMenuQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.locations'))).toBe(false)
    const duplicateQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO public.locations')) throw Object.assign(new Error('duplicate'), { code: '23505' })
      return { rows: [] }
    })
    await expect(mutateAdminLocation(duplicateQuery, context, { kind: 'create', body: { name: 'Branch', slug: 'branch' } })).rejects.toMatchObject({ status: 409 })
  })

  it('patches only the own location and clears the optional menu reference', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values
      if (sql.includes('SELECT id FROM public.locations')) return { rows: [{ id: locationId }] }
      if (sql.includes('UPDATE public.locations')) return { rows: [{ row: { ...location, menu_id: null, is_active: false } }] }
      return { rows: [] }
    })
    await expect(mutateAdminLocation(query, context, { kind: 'patch', id: locationId, body: { menu_id: null, is_active: false, tenant_id: randomUUID() } })).resolves.toMatchObject({ menu_id: null, is_active: false })
    expect(query.mock.calls.at(-1)?.[1]).toEqual([tenantId, locationId, false, null])
    const absent = vi.fn(async () => ({ rows: [] }))
    await expect(mutateAdminLocation(absent, context, { kind: 'patch', id: locationId, body: { name: 'New' } })).rejects.toMatchObject({ status: 404 })
  })

  it('requires an active/trial payments entitlement under a row lock before writing zones', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'cancelled', features: ['payments'] }] }
      return { rows: [] }
    })
    await expect(mutateAdminDeliveryZone(query, context, { kind: 'create', body: { name: 'Central', fee_cents: 450, zipcode_prefixes: ['100'] } })).rejects.toMatchObject({ status: 403 })
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF s,p'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.delivery_zones'))).toBe(false)
  })

  it('creates zones with cents and prefix arrays intact and refuses corrupt cross-tenant order references before delete', async () => {
    const createQuery = vi.fn(async (sql: string) => {
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'active', features: ['payments'] }] }
      if (sql.includes('INSERT INTO public.delivery_zones')) return { rows: [{ row: zone }] }
      return { rows: [] }
    })
    await expect(mutateAdminDeliveryZone(createQuery, context, { kind: 'create', body: { name: 'Central', fee_cents: 450, zipcode_prefixes: ['100'] } })).resolves.toEqual(zone)
    const foreignOrderQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.delivery_zones')) return { rows: [{ id: zoneId, tenant_id: tenantId }] }
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'trial', features: ['payments'] }] }
      if (sql.includes('FROM public.orders')) return { rows: [{ id: randomUUID(), tenant_id: randomUUID() }] }
      return { rows: [] }
    })
    await expect(mutateAdminDeliveryZone(foreignOrderQuery, context, { kind: 'delete', id: zoneId })).rejects.toMatchObject({ status: 409 })
    expect(foreignOrderQuery.mock.calls.some(([sql]) => sql.includes('tenant_id<>$2') && sql.includes('LIMIT 1 FOR UPDATE'))).toBe(true)
    expect(foreignOrderQuery.mock.calls.some(([sql]) => sql.includes('DELETE FROM public.delivery_zones'))).toBe(false)
  })

  it('fails closed on malformed tenant scope and invalid delivery fee', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'active', features: ['payments'] }] }
      return { rows: [] }
    })
    await expect(readAdminLocationsPage(query, { tenantId: 'other', role: 'store-admin' })).rejects.toBeInstanceOf(AdminMenuError)
    await expect(mutateAdminDeliveryZone(query, context, { kind: 'create', body: { name: 'Central', fee_cents: Number.NaN } })).rejects.toMatchObject({ status: 400 })
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.delivery_zones'))).toBe(false)
  })
})
