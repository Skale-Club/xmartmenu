import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ effective: vi.fn(), locations: vi.fn(), zones: vi.fn(), mutateLocation: vi.fn(), mutateZone: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/data/admin-locations-runtime', () => ({
  readOwnedLocations: mocks.locations,
  readOwnedDeliveryZones: mocks.zones,
  mutateOwnedLocation: mocks.mutateLocation,
  mutateOwnedDeliveryZone: mocks.mutateZone,
}))

import { ownedDeliveryZoneHttp, ownedLocationHttp } from '@/lib/admin/owned-locations-http'

const tenantId = '1d8f5270-73e3-42ee-95f0-b849c26dbb4d'
const request = (method: string, path: string, body?: unknown, origin = 'https://menu.example.test') => new Request(`https://menu.example.test${path}`, {
  method,
  headers: { host: 'menu.example.test', origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(() => {
  mocks.effective.mockResolvedValue({ tenantId, role: 'store-admin' })
  mocks.locations.mockResolvedValue([])
  mocks.zones.mockResolvedValue([])
  mocks.mutateLocation.mockResolvedValue({ id: 'location-id' })
  mocks.mutateZone.mockResolvedValue({ ok: true })
})
afterEach(() => vi.resetAllMocks())

describe('owned locations API boundary', () => {
  it('allows staff reads but denies writes before parsing and requires exact Origin', async () => {
    mocks.effective.mockResolvedValueOnce({ tenantId, role: 'store-staff' })
    expect((await ownedLocationHttp(request('GET', '/api/admin/locations'), 'list')).status).toBe(200)
    mocks.effective.mockResolvedValueOnce({ tenantId, role: 'store-staff' })
    expect((await ownedLocationHttp(new Request('https://menu.example.test/api/admin/locations', { method: 'POST', body: '{invalid' }), 'create')).status).toBe(403)
    expect(mocks.mutateLocation).not.toHaveBeenCalled()
    expect((await ownedLocationHttp(request('POST', '/api/admin/locations', { name: 'Branch' }, 'https://evil.example.test'), 'create')).status).toBe(403)
    expect(mocks.mutateLocation).not.toHaveBeenCalled()
  })

  it('uses effective tenant and returns no-store on successful writes', async () => {
    const response = await ownedLocationHttp(request('POST', '/api/admin/locations', { name: 'Branch', slug: 'branch' }), 'create')
    expect(response.status).toBe(201)
    expect(mocks.mutateLocation).toHaveBeenCalledWith({ tenantId, role: 'store-admin' }, { kind: 'create', body: { name: 'Branch', slug: 'branch' } })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('owned delivery zones API boundary', () => {
  it('preserves staff read and scoped not-found behavior for anonymous id mutations', async () => {
    mocks.effective.mockResolvedValueOnce({ tenantId, role: 'store-staff' })
    expect((await ownedDeliveryZoneHttp(request('GET', '/api/admin/delivery-zones'), 'list')).status).toBe(200)
    mocks.effective.mockResolvedValueOnce(null)
    expect((await ownedDeliveryZoneHttp(request('DELETE', '/api/admin/delivery-zones/zone-id'), 'delete', 'zone-id')).status).toBe(404)
    expect(mocks.mutateZone).not.toHaveBeenCalled()
  })

  it('routes plan-gated mutations through the owned transaction and sanitizes errors', async () => {
    const response = await ownedDeliveryZoneHttp(request('DELETE', '/api/admin/delivery-zones/zone-id'), 'delete', 'zone-id')
    expect(response.status).toBe(200)
    expect(mocks.mutateZone).toHaveBeenCalledWith({ tenantId, role: 'store-admin' }, { kind: 'delete', id: 'zone-id' })
    mocks.mutateZone.mockRejectedValueOnce(new Error('private database detail'))
    const unavailable = await ownedDeliveryZoneHttp(request('DELETE', '/api/admin/delivery-zones/zone-id'), 'delete', 'zone-id')
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('private database detail')
  })
})
