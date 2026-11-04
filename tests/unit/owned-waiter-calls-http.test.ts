import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { randomUUID } from 'node:crypto'
const mocks = vi.hoisted(() => ({ effective: vi.fn(),principal: vi.fn(),requestContext: vi.fn(),read: vi.fn(),update: vi.fn(),source: vi.fn() }))
vi.mock('@/lib/get-effective-tenant',() => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/auth/owned-principal-runtime',() => ({ getOwnedPrincipal: mocks.principal }))
vi.mock('@/lib/observability/context',() => ({ getRequestContext: mocks.requestContext }))
vi.mock('@/lib/data/admin-waiter-calls-runtime',() => ({ readOwnedAdminWaiterCalls: mocks.read,updateOwnedAdminWaiterCall: mocks.update }))
vi.mock('@/lib/supabase/server',() => ({ createClient: mocks.source,createServiceClient: mocks.source }))
import { ownedWaiterCallsHttp } from '@/lib/admin/owned-waiter-calls-http'

const tenantId = randomUUID(), actorId = randomUUID(), callId = randomUUID()
const principal = { userId: actorId,tenantId,role: 'store-staff',mustChangePassword: false }
const request = (body?: unknown,origin = 'https://menu.test') => new Request('https://menu.test/api/admin/waiter-calls',{
  method: body === undefined ? 'GET' : 'PATCH',headers: { host: 'menu.test',origin,'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
beforeEach(() => {
  vi.stubEnv('OWNED_AUTH_ENABLED','true')
  mocks.effective.mockResolvedValue({ tenantId,role: 'store-staff' })
  mocks.principal.mockResolvedValue(principal)
  mocks.read.mockResolvedValue({ calls: [] }); mocks.update.mockResolvedValue({ call: { id: callId } })
})
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })

describe('owned waiter HTTP authority',() => {
  it('takes the tenant and actor from current guards and retains response envelopes',async () => {
    const listed = await ownedWaiterCallsHttp(request())
    expect(listed.status).toBe(200); expect(await listed.json()).toEqual({ calls: [] })
    expect(listed.headers.get('cache-control')).toBe('private, no-store')
    const updated = await ownedWaiterCallsHttp(request({ status: 'acknowledged' }),callId)
    expect(updated.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ tenantId,role: 'store-staff',actorId },callId,'acknowledged')
  })
  it('denies absent/disabled/revoked, recovery and mismatched native principals without Source fallback',async () => {
    for (const value of [null,{ ...principal,mustChangePassword: true },{ ...principal,tenantId: randomUUID() },{ ...principal,role: 'customer' }]) {
      mocks.principal.mockResolvedValue(value)
      expect((await ownedWaiterCallsHttp(request({ status: 'done' }),callId)).status).toBe(401)
    }
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled()
  })
  it('rejects cross-origin, oversized and injected account/tenant/role fields before SQL mutations',async () => {
    expect((await ownedWaiterCallsHttp(request({ status: 'done' },'https://evil.test'),callId)).status).toBe(403)
    for (const extra of [{ actorId: randomUUID() },{ tenantId: randomUUID() },{ role: 'superadmin' },{ extra: 'x'.repeat(3000) }]) {
      expect((await ownedWaiterCallsHttp(request({ status: 'done',...extra }),callId)).status).toBe(400)
    }
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('uses only the existing verified request actor when legacy authority is explicitly selected',async () => {
    vi.stubEnv('OWNED_AUTH_ENABLED','false'); mocks.requestContext.mockReturnValue({ actorId })
    expect((await ownedWaiterCallsHttp(request({ status: 'done' }),callId)).status).toBe(200)
    expect(mocks.principal).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled()
    mocks.requestContext.mockReturnValue(undefined)
    expect((await ownedWaiterCallsHttp(request())).status).toBe(401)
  })
})
