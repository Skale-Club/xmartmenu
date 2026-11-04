import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'

const mocks = vi.hoisted(() => ({ effective: vi.fn(), legacy: vi.fn(), list: vi.fn(), find: vi.fn(), mutate: vi.fn(), cookie: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.legacy }))
vi.mock('@/lib/data/admin-menus-runtime', () => ({ listOwnedAdminMenus: mocks.list, findOwnedAdminMenu: mocks.find, mutateOwnedAdminMenu: mocks.mutate }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie }) }))

import { GET as GETRoute, POST as POSTRoute } from '@/app/api/admin/menus/route'
import { PATCH, DELETE } from '@/app/api/admin/menus/[id]/route'
import { POST as SELECTRoute } from '@/app/api/admin/menus/select/route'
import { listAdminMenus } from '@/lib/admin/menu-data'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'

const tenantId = randomUUID(), id = randomUUID(), menu = { id, name: 'Dinner', is_default: true, is_active: false }
const request = (method = 'POST', body: unknown = { name: 'Dinner' }) => new Request('http://localhost/api/admin/menus', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const params = { params: Promise.resolve({ id }) }
const GET = () => GETRoute(new Request('http://localhost/api/admin/menus'), undefined)
const POST = (input: Request) => POSTRoute(input, undefined)
const SELECT = (input: Request) => SELECTRoute(input, undefined)

beforeEach(() => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
  mocks.effective.mockResolvedValue({ tenantId, role: 'store-admin', slug: 'restaurant', name: 'Restaurant' })
  mocks.list.mockResolvedValue([menu]); mocks.find.mockResolvedValue(menu); mocks.mutate.mockResolvedValue(menu)
  mocks.cookie.mockReturnValue({ value: id })
  mocks.legacy.mockImplementation(() => { throw Error('Legacy menu client must not be created') })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

describe('administrative menu source boundary', () => {
  it('routes list/create/patch/delete through owned handlers without legacy data factories', async () => {
    expect(await (await GET()).json()).toEqual([menu])
    expect((await POST(request())).status).toBe(201)
    expect((await PATCH(request('PATCH', { is_default: true }), params)).status).toBe(200)
    mocks.mutate.mockResolvedValueOnce({ ok: true })
    expect(await (await DELETE(request('DELETE'), params)).json()).toEqual({ ok: true })
    expect(mocks.mutate.mock.calls.map(call => call[1].kind)).toEqual(['create', 'patch', 'delete'])
    for (const call of mocks.mutate.mock.calls) expect(call[0]).toEqual({ tenantId, role: 'store-admin' })
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('keeps anonymous denial and staff read/select-only permissions and cookie flags', async () => {
    mocks.effective.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(401)
    mocks.effective.mockResolvedValueOnce(null)
    expect((await PATCH(request('PATCH'), params)).status).toBe(404)
    mocks.effective.mockResolvedValue({ tenantId, role: 'store-staff' })
    expect((await GET()).status).toBe(200)
    expect((await POST(request())).status).toBe(403)
    expect((await PATCH(request('PATCH'), params)).status).toBe(403)
    expect((await DELETE(request('DELETE'), params)).status).toBe(403)
    const response = await SELECT(request('POST', { menu_id: id }))
    expect(await response.json()).toEqual({ ok: true, menu_id: id })
    expect(response.headers.get('set-cookie')).toMatch(/selected_menu_id=.*HttpOnly.*SameSite=lax/i)
    expect(mocks.mutate).not.toHaveBeenCalled()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('keeps foreign menu existence hidden from staff and rejects foreign selection', async () => {
    mocks.effective.mockResolvedValue({ tenantId, role: 'store-staff' })
    mocks.find.mockResolvedValue(null)
    expect((await PATCH(request('PATCH'), params)).status).toBe(404)
    expect((await SELECT(request('POST', { menu_id: randomUUID() }))).status).toBe(404)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
  it('fails closed on owned configuration/provider errors and preserves expected domain errors', async () => {
    const secret = randomUUID()
    mocks.list.mockRejectedValue(Error(secret))
    const unavailable = await GET()
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain(secret)
    mocks.mutate.mockRejectedValue(new AdminMenuError(400, 'Cannot delete the default menu'))
    expect((await DELETE(request('DELETE'), params)).status).toBe(400)
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('uses owned lists for shared active-menu resolution and refuses database failures without fallback', async () => {
    expect(await listAdminMenus(tenantId)).toEqual([menu])
    expect(await getActiveMenuForTenant(tenantId)).toEqual(menu)
    mocks.list.mockRejectedValue(Error('unavailable'))
    await expect(getActiveMenuForTenant(tenantId)).rejects.toThrow('unavailable')
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('keeps the legacy list source when the flag is disabled', async () => {
    vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'false')
    const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: [menu] }) }
    mocks.legacy.mockResolvedValue({ from: () => chain })
    expect(await listAdminMenus(tenantId)).toEqual([menu])
    expect(mocks.legacy).toHaveBeenCalledOnce()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
