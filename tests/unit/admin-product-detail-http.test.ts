import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), mutate: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.tenant }))
vi.mock('@/lib/data/admin-product-detail-runtime', () => ({ mutateOwnedProductDetail: mocks.mutate }))
import { ownedProductDetailHttp } from '@/lib/admin/owned-product-detail-http'
import { detailOperation, groupFields, optionFields, ingredientAssociationFields } from '@/lib/data/admin-product-detail'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'true')
  mocks.tenant.mockResolvedValue({ tenantId: 'tenant-a', role: 'store-admin' })
  mocks.mutate.mockResolvedValue([])
})
const request = (body: unknown) => new Request('https://menu.example.test/api/admin/products/product-a/catalog', {
  method: 'POST', headers: { origin: 'https://menu.example.test' }, body: JSON.stringify(body),
})
describe('product configuration authority and field boundaries', () => {
  it('rejects disabled, anonymous and staff writes while allowing staff media reads', async () => {
    const input = { entity: 'options', action: 'delete', id: 'option-a' }
    vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'false')
    expect((await ownedProductDetailHttp(request(input), 'product-a')).status).toBe(404)
    expect(mocks.tenant).not.toHaveBeenCalled()
    vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'true')
    mocks.tenant.mockResolvedValueOnce(null)
    expect((await ownedProductDetailHttp(request(input), 'product-a')).status).toBe(401)
    mocks.tenant.mockResolvedValue({ tenantId: 'tenant-a', role: 'store-staff' })
    expect((await ownedProductDetailHttp(request(input), 'product-a')).status).toBe(403)
    expect(mocks.mutate).not.toHaveBeenCalled()
    const response = await ownedProductDetailHttp(request({ entity: 'media', action: 'list' }), 'product-a')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.mutate).toHaveBeenCalledWith({ tenantId: 'tenant-a', role: 'store-staff' }, 'product-a', { entity: 'media', action: 'list' })
  })
  it('rejects unimplemented actions and caller authority metadata before reaching SQL', async () => {
    for (const input of [{ entity: 'profiles', action: 'delete' }, { entity: 'groups', action: 'list' }, { entity: ['media'], action: 'list' },
      { entity: 'media', action: 'patch' }, { entity: 'groups', action: 'create', tenantId: 'other' }]) {
      expect((await ownedProductDetailHttp(request(input), 'product-a')).status).toBe(400)
    }
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
  it('denies another origin and hides unexpected SQL/provider diagnostics without retries', async () => {
    const foreign = new Request('https://menu.example.test/api/admin/products/p/catalog', { method: 'POST', headers: { origin: 'https://other.example.test' }, body: '{}' })
    expect((await ownedProductDetailHttp(foreign, 'p')).status).toBe(403)
    mocks.mutate.mockRejectedValueOnce(new Error('private database detail'))
    const response = await ownedProductDetailHttp(request({ entity: 'media', action: 'list' }), 'product-a')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Product configuration is unavailable' })
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
  })
  it('preserves signed modifiers and independent group limits while rejecting malformed values', () => {
    expect(optionFields({ name: 'Discount', base_price: null, price_modifier: -2.25, is_available: true }, true).price_modifier).toBe(-2.25)
    expect(groupFields({ name: 'Choice', min_selections: 3, max_selections: 1 }, true).min_selections).toBe(3)
    for (const values of [{ price_modifier: Number.POSITIVE_INFINITY }, { base_price: -1 }, { tenant_id: 'other' }]) expect(() => optionFields(values, false)).toThrow()
    expect(() => groupFields({ type: ['single'] }, false)).toThrow()
    expect(() => ingredientAssociationFields({ extra_price_override: -1 }, false)).toThrow()
    expect(() => detailOperation({ entity: 'ingredients', action: 'reorder' })).toThrow()
  })
})
