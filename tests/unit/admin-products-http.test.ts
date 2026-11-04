import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), mutate: vi.fn(), cookies: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.tenant }))
vi.mock('@/lib/data/admin-products-runtime', () => ({ mutateOwnedProduct: mocks.mutate }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
import { ownedProductHttp } from '@/lib/admin/owned-product-http'
import { productPatch } from '@/lib/data/admin-products'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'true')
  mocks.tenant.mockResolvedValue({ tenantId: 'tenant-a', role: 'store-admin' })
  mocks.mutate.mockResolvedValue({ id: 'saved' })
  mocks.cookies.mockResolvedValue({ get: () => ({ value: 'selected-menu' }) })
})
const request = (origin = 'https://menu.example.test') => new Request('https://menu.example.test/api/admin/products', {
  method: 'POST', headers: { origin }, body: '{"name":"Dish","price":12}',
})
describe('owned product admission', () => {
  it('keeps disabled, anonymous, staff and cross-origin requests away from SQL', async () => {
    vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'false')
    expect((await ownedProductHttp(request(), 'create')).status).toBe(404)
    expect(mocks.tenant).not.toHaveBeenCalled()
    vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'true')
    mocks.tenant.mockResolvedValueOnce(null)
    expect((await ownedProductHttp(request(), 'create')).status).toBe(401)
    mocks.tenant.mockResolvedValueOnce({ tenantId: 'tenant-a', role: 'store-staff' })
    expect((await ownedProductHttp(request(), 'create')).status).toBe(403)
    expect((await ownedProductHttp(request('https://other.example.test'), 'create')).status).toBe(403)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
  it('uses the current server scope and selection cookie, with cache-disabled responses', async () => {
    const response = await ownedProductHttp(request(), 'create')
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.mutate).toHaveBeenCalledWith({ tenantId: 'tenant-a', role: 'store-admin' },
      { kind: 'create', body: { name: 'Dish', price: 12 }, selectedMenuId: 'selected-menu' })
  })
  it('sanitizes failed writes without retrying or using another data source', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('private SQL detail'))
    const response = await ownedProductHttp(request(), 'patch', 'product-a')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Product service is unavailable' })
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
  })
})
describe('product editable fields', () => {
  it('rejects forged authority, unsafe images and invalid prices while keeping nullable original price', () => {
    for (const body of [{ tenant_id: 'foreign' }, { menu_id: 'foreign' }, { position: 2 }, { price: -1 },
      { price: Number.NaN }, { price: 100000000 }, { image_url: 'javascript:bad' }, { tags: [{}] }]) expect(() => productPatch(body)).toThrow()
    expect(productPatch({ name: ' Dish ', price: 0, original_price: null }, true)).toEqual({ name: 'Dish', price: 0, original_price: null })
  })
})
