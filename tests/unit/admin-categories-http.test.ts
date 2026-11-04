import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), cookies: vi.fn(), mutate: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.tenant }))
vi.mock('@/lib/data/admin-categories-runtime', () => ({ mutateOwnedCategory: mocks.mutate }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
import { ownedCategoryHttp } from '@/lib/admin/owned-category-http'

const request = (origin = 'https://menu.example.test', body: unknown = { name: 'Drinks' }) => new Request('https://menu.example.test/api/admin/categories', {
  method: 'POST', headers: { origin, host: 'menu.example.test', 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
  mocks.tenant.mockResolvedValue({ tenantId: 'e7b7f160-0000-4000-8000-000000000001', role: 'store-admin' })
  mocks.cookies.mockResolvedValue({ get: () => ({ value: 'e7b7f160-0000-4000-8000-000000000002' }) })
  mocks.mutate.mockResolvedValue({ id: 'category-1' })
})

describe('owned category HTTP boundary', () => {
  it('keeps the route closed when the shared menus flag is off', async () => {
    vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'false')
    expect((await ownedCategoryHttp(request(), 'create')).status).toBe(404)
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
  it('rejects anonymous and staff writes before parsing or SQL', async () => {
    mocks.tenant.mockResolvedValueOnce(null)
    const invalid = () => new Request('https://menu.example.test', { method: 'POST', body: '{' })
    expect((await ownedCategoryHttp(invalid(), 'create')).status).toBe(401)
    mocks.tenant.mockResolvedValueOnce({ tenantId: 'e7b7f160-0000-4000-8000-000000000001', role: 'store-staff' })
    expect((await ownedCategoryHttp(invalid(), 'create')).status).toBe(403)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
  it('requires an exact same-origin write and passes the selected menu only as a hint', async () => {
    expect((await ownedCategoryHttp(request('https://evil.example.test'), 'create')).status).toBe(403)
    expect(mocks.mutate).not.toHaveBeenCalled()
    expect((await ownedCategoryHttp(request(), 'create')).status).toBe(201)
    expect(mocks.mutate).toHaveBeenCalledWith(
      { tenantId: 'e7b7f160-0000-4000-8000-000000000001', role: 'store-admin' },
      { kind: 'create', body: { name: 'Drinks' }, selectedMenuId: 'e7b7f160-0000-4000-8000-000000000002' },
    )
    expect((await ownedCategoryHttp(request(), 'create')).headers.get('cache-control')).toBe('private, no-store')
  })
  it('sanitizes failures and uses legacy-compatible delete response', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('private database detail'))
    const failed = await ownedCategoryHttp(request(), 'create')
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: 'Category service is unavailable' })
    mocks.mutate.mockResolvedValueOnce({ ok: true })
    const deleted = await ownedCategoryHttp(new Request('https://menu.example.test', { method: 'DELETE', headers: { origin: 'https://menu.example.test', host: 'menu.example.test' } }), 'delete', 'category-1')
    expect(await deleted.json()).toEqual({ success: true })
  })
})
