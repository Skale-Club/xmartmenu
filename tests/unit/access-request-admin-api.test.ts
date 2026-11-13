import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  owned: vi.fn(), list: vi.fn(), approve: vi.fn(), decline: vi.fn(), reopen: vi.fn(), publish: vi.fn(), revalidate: vi.fn(),
}))

vi.mock('@/lib/auth/owned-principal', () => ({ ownedAuthSelected: mocks.owned, ownedSessionToken: vi.fn(), UUID: /.*/ }))
vi.mock('@/lib/data/tenant-administration-runtime', () => ({
  ownedPlans: vi.fn(), ownedTenants: vi.fn(), ownedTenantSettings: vi.fn(), ownedTenantMenuRows: vi.fn(),
}))
vi.mock('@/lib/access-requests/admin-runtime', () => ({
  ownedAccessRequests: mocks.list, ownedApproveAccessRequest: mocks.approve,
  ownedDeclineAccessRequest: mocks.decline, ownedReopenAccessRequest: mocks.reopen,
}))
vi.mock('@/lib/tenant-effects/publish-pending', () => ({ publishPendingNativeTenantEffects: mocks.publish }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_name: string, handler: unknown) => handler }))

import { AdminMenuError } from '@/lib/data/admin-menus'
import { AccessRequestError } from '@/lib/access-requests/store'
import { GET } from '@/app/api/superadmin/access-requests/route'
import { POST as approvePost } from '@/app/api/superadmin/access-requests/[id]/approve/route'
import { POST as declinePost } from '@/app/api/superadmin/access-requests/[id]/decline/route'
import { POST as reopenPost } from '@/app/api/superadmin/access-requests/[id]/reopen/route'

const ID = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ id: ID }) }
const req = (body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/superadmin/access-requests/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.test', host: 'app.test', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const row = { id: ID, status: 'approved' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.owned.mockReturnValue(true)
  mocks.publish.mockResolvedValue(undefined)
})

describe('superadmin access requests API', () => {
  it('is 404 for every route when owned auth is off', async () => {
    mocks.owned.mockReturnValue(false)
    expect((await GET(new Request('https://app.test/api/x'))).status).toBe(404)
    expect((await approvePost(req({ mode: 'existing' }), params)).status).toBe(404)
    expect((await declinePost(req({}), params)).status).toBe(404)
    expect((await reopenPost(req(), params)).status).toBe(404)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('lists requests privately', async () => {
    mocks.list.mockResolvedValue([row])
    const res = await GET(new Request('https://app.test/api/x'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual([row])
  })

  it('approve passes the id and parsed body, and publishes effects only for a created tenant', async () => {
    const body = { mode: 'new', name: 'Casa', slug: 'casa', plan_id: ID }
    mocks.approve.mockResolvedValueOnce({ request: row, tenantId: 't1', createdTenant: true })
    const created = await approvePost(req(body), params)
    expect(created.status).toBe(200)
    expect(mocks.approve).toHaveBeenCalledWith(ID, body)
    expect(mocks.publish).toHaveBeenCalledWith('t1')
    expect(mocks.revalidate).toHaveBeenCalledWith('/tenants')

    mocks.publish.mockClear()
    mocks.approve.mockResolvedValueOnce({ request: row, tenantId: 't2', createdTenant: false })
    const linked = await approvePost(req({ mode: 'existing', tenant_id: ID }), params)
    expect(linked.status).toBe(200)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('does not fail the approval when publishing effects fails', async () => {
    mocks.approve.mockResolvedValue({ request: row, tenantId: 't1', createdTenant: true })
    mocks.publish.mockRejectedValue(new Error('queue down'))
    expect((await approvePost(req({ mode: 'new' }), params)).status).toBe(200)
  })

  it('maps AccessRequestError and AdminMenuError to their status and message', async () => {
    mocks.approve.mockRejectedValueOnce(new AccessRequestError(409, 'Only a pending request can be approved'))
    const conflict = await approvePost(req({ mode: 'new' }), params)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'Only a pending request can be approved' })

    mocks.approve.mockRejectedValueOnce(new AdminMenuError(400, 'Invalid slug'))
    const bad = await approvePost(req({ mode: 'new' }), params)
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'Invalid slug' })
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('answers 503 for unexpected and missing-table errors', async () => {
    mocks.approve.mockRejectedValueOnce(new Error('boom'))
    expect((await approvePost(req({ mode: 'new' }), params)).status).toBe(503)
    mocks.list.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42P01' }))
    const res = await GET(new Request('https://app.test/api/x'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Access requests are unavailable.' })
  })

  it('declines and reopens', async () => {
    mocks.decline.mockResolvedValue({ request: { ...row, status: 'declined' } })
    const declined = await declinePost(req({ note: 'no fit' }), params)
    expect(declined.status).toBe(200)
    expect(mocks.decline).toHaveBeenCalledWith(ID, { note: 'no fit' })

    mocks.reopen.mockResolvedValue({ request: { ...row, status: 'pending' } })
    const reopened = await reopenPost(req(), params)
    expect(reopened.status).toBe(200)
    expect(mocks.reopen).toHaveBeenCalledWith(ID)
  })

  it('refuses cross-origin mutations with 403 before touching the runtime', async () => {
    const evil = { origin: 'https://evil.test' }
    expect((await approvePost(req({ mode: 'new' }, evil), params)).status).toBe(403)
    expect((await declinePost(req({}, evil), params)).status).toBe(403)
    expect((await reopenPost(req(undefined, evil), params)).status).toBe(403)
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.decline).not.toHaveBeenCalled()
    expect(mocks.reopen).not.toHaveBeenCalled()
  })
})
