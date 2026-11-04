import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), list: vi.fn(), mutate: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.tenant }))
vi.mock('@/lib/data/admin-ingredients-runtime', () => ({ listOwnedIngredients: mocks.list, mutateOwnedIngredient: mocks.mutate }))
import { ownedIngredientHttp } from '@/lib/admin/owned-ingredient-http'
import { ingredientPatch } from '@/lib/data/admin-ingredients'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'true')
  mocks.tenant.mockResolvedValue({ tenantId: 'tenant-a', role: 'store-admin' })
  mocks.list.mockResolvedValue([])
  mocks.mutate.mockResolvedValue({ ok: true })
})
const request = (origin = 'https://menu.example.test', body: unknown = { name: 'Salt' }) => new Request('https://menu.example.test/api/admin/ingredients', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
})
describe('owned ingredient HTTP admission', () => {
  it('keeps disabled routes closed without invoking identity or SQL', async () => {
    vi.stubEnv('OWNED_ADMIN_CATALOG_ENABLED', 'false')
    expect((await ownedIngredientHttp(request(), 'create')).status).toBe(404)
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
  it('denies anonymous and staff mutations without parsing the body or opening a write', async () => {
    const bad = () => new Request('https://menu.example.test/api/admin/ingredients', { method: 'POST', body: '{invalid' })
    mocks.tenant.mockResolvedValueOnce(null)
    expect((await ownedIngredientHttp(bad(), 'create')).status).toBe(401)
    mocks.tenant.mockResolvedValueOnce({ tenantId: 'tenant-a', role: 'store-staff' })
    expect((await ownedIngredientHttp(bad(), 'create')).status).toBe(403)
    expect(mocks.mutate).not.toHaveBeenCalled()
    mocks.tenant.mockResolvedValueOnce({ tenantId: 'tenant-a', role: 'store-staff' })
    expect((await ownedIngredientHttp(request(), 'list')).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({ tenantId: 'tenant-a', role: 'store-staff' })
  })
  it('uses current server tenant/role and enforces exact write origin', async () => {
    expect((await ownedIngredientHttp(request('https://other.example.test'), 'create')).status).toBe(403)
    expect(mocks.mutate).not.toHaveBeenCalled()
    expect((await ownedIngredientHttp(request(), 'create')).status).toBe(201)
    expect(mocks.mutate).toHaveBeenCalledWith({ tenantId: 'tenant-a', role: 'store-admin' }, { kind: 'create', body: { name: 'Salt' } })
    const proxied = new Request('https://internal.example.test/api/admin/ingredients', { method: 'POST',
      headers: { host: 'menu.example.test', origin: 'https://menu.example.test' }, body: '{"name":"Salt"}' })
    const response = await ownedIngredientHttp(proxied, 'create')
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('sanitizes unexpected SQL/provider failures and never invokes an alternate source', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('private connection detail'))
    const response = await ownedIngredientHttp(request(), 'create')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Ingredient service is unavailable' })
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
  })
})
describe('ingredient mutation fields', () => {
  it('rejects authority/identity fields, invalid money and invalid availability', () => {
    for (const body of [{ name: 'Salt', tenant_id: 'foreign' }, { id: 'foreign' }, { name: ' ' }, { default_extra_price: -1 },
      { default_add_price: Number.POSITIVE_INFINITY }, { default_add_price: 100000000 }, { is_available: 'true' }]) {
      expect(() => ingredientPatch(body)).toThrow()
    }
    expect(ingredientPatch({ name: ' Salt ' }, true)).toEqual({ name: 'Salt', default_extra_price: 0, default_add_price: 0, is_available: true })
  })
})
