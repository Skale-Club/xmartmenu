import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ effective: vi.fn(), activeMenu: vi.fn(), qrCodes: vi.fn(), createQr: vi.fn(), deleteQr: vi.fn(), tables: vi.fn(), mutateTable: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/get-active-menu', () => ({ getActiveMenuForTenant: mocks.activeMenu }))
vi.mock('@/lib/data/admin-store-operations-runtime', () => ({
  readOwnedQrCodes: mocks.qrCodes,
  createOwnedQrCode: mocks.createQr,
  deleteOwnedQrCode: mocks.deleteQr,
  readOwnedRestaurantTables: mocks.tables,
  mutateOwnedRestaurantTable: mocks.mutateTable,
}))

import { ownedQrCollectionHttp, ownedQrItemHttp, ownedRestaurantTableCollectionHttp, ownedRestaurantTableItemHttp } from '@/lib/admin/owned-store-operations-http'

const tenantId = '1d8f5270-73e3-42ee-95f0-b849c26dbb4d'
const request = (method: string, path: string, body?: unknown, origin = 'https://menu.example.test') => new Request(`https://menu.example.test${path}`, {
  method,
  headers: { host: 'menu.example.test', origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(() => {
  mocks.effective.mockResolvedValue({ tenantId, slug: 'restaurant', name: 'Restaurant', role: 'store-admin' })
  mocks.activeMenu.mockResolvedValue({ slug: 'lunch', is_default: false })
  mocks.qrCodes.mockResolvedValue([])
  mocks.createQr.mockResolvedValue({ id: 'qr-id', target_url: 'https://menu.example.test/restaurant/lunch?source=Front+Window' })
  mocks.deleteQr.mockResolvedValue({ ok: true })
  mocks.tables.mockResolvedValue([])
  mocks.mutateTable.mockResolvedValue({ id: 'table-id', name: 'Table 1' })
})
afterEach(() => vi.resetAllMocks())

describe('owned Store operations HTTP boundaries', () => {
  it('derives QR tenant/path server-side and restricts QR writes to managers', async () => {
    mocks.effective.mockResolvedValueOnce({ tenantId, slug: 'restaurant', role: 'store-staff' })
    expect((await ownedQrCollectionHttp(request('GET', '/api/admin/qr-codes'), 'list')).status).toBe(200)
    mocks.effective.mockResolvedValueOnce({ tenantId, slug: 'restaurant', role: 'store-staff' })
    expect((await ownedQrCollectionHttp(request('POST', '/api/admin/qr-codes', { label: 'Front' }), 'create')).status).toBe(403)
    expect(mocks.createQr).not.toHaveBeenCalled()

    const response = await ownedQrCollectionHttp(request('POST', '/api/admin/qr-codes', { tenant_id: 'forged', label: 'Front Window' }), 'create')
    expect(response.status).toBe(201)
    expect(mocks.activeMenu).toHaveBeenCalledWith(tenantId)
    expect(mocks.createQr).toHaveBeenCalledWith(
      { tenantId, role: 'store-admin' },
      'Front Window',
      expect.stringContaining('/restaurant/lunch?source=Front%20Window'),
    )
  })

  it('tenant-scopes QR delete and requires same-origin mutations', async () => {
    expect((await ownedQrItemHttp(request('DELETE', '/api/admin/qr-codes/qr-id', undefined, 'https://evil.test'), 'qr-id')).status).toBe(403)
    expect(mocks.deleteQr).not.toHaveBeenCalled()
    expect((await ownedQrItemHttp(request('DELETE', '/api/admin/qr-codes/qr-id'), 'qr-id')).status).toBe(200)
    expect(mocks.deleteQr).toHaveBeenCalledWith({ tenantId, role: 'store-admin' }, 'qr-id')
  })

  it('preserves tenant-table staff access and rejects forged tenant IDs and cross-origin requests', async () => {
    mocks.effective.mockResolvedValueOnce({ tenantId, slug: 'restaurant', role: 'store-staff' })
    expect((await ownedRestaurantTableCollectionHttp(request('GET', '/api/admin/restaurant-tables'), 'list')).status).toBe(200)
    mocks.effective.mockResolvedValueOnce({ tenantId, slug: 'restaurant', role: 'store-staff' })
    const create = await ownedRestaurantTableCollectionHttp(request('POST', '/api/admin/restaurant-tables', { name: ' Table 1 ', tenant_id: 'forged' }), 'create')
    expect(create.status).toBe(201)
    expect(mocks.mutateTable).toHaveBeenCalledWith({ tenantId, role: 'store-staff' }, { kind: 'create', name: ' Table 1 ' })
    expect((await ownedRestaurantTableCollectionHttp(request('PATCH', '/api/admin/restaurant-tables', { firstId: 'a', secondId: 'b' }, 'https://evil.test'), 'reorder')).status).toBe(403)
  })

  it('routes deletion and reorder requests without exposing internal errors', async () => {
    const reorder = await ownedRestaurantTableCollectionHttp(request('PATCH', '/api/admin/restaurant-tables', { firstId: 'first', secondId: 'second' }), 'reorder')
    expect(reorder.status).toBe(200)
    expect(mocks.mutateTable).toHaveBeenCalledWith({ tenantId, role: 'store-admin' }, { kind: 'reorder', firstId: 'first', secondId: 'second' })
    expect((await ownedRestaurantTableItemHttp(request('DELETE', '/api/admin/restaurant-tables/id'), 'id')).status).toBe(200)
    mocks.mutateTable.mockRejectedValueOnce(new Error('db password detail'))
    const unavailable = await ownedRestaurantTableItemHttp(request('DELETE', '/api/admin/restaurant-tables/id'), 'id')
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('db password detail')
  })
})
