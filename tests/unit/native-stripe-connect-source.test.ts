import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
const state = vi.hoisted(() => ({ source: vi.fn(), cookie: vi.fn(), effective: vi.fn(), context: vi.fn(), read: vi.fn(), claim: vi.fn(), refuse: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), token: vi.fn(), deauth: vi.fn(), enqueue: vi.fn(), headers: vi.fn(), session: vi.fn(), publish: vi.fn(), currency: vi.fn(), connection: vi.fn(), available: vi.fn(), feature: vi.fn(), order: [] as string[] }))
vi.mock('@/lib/supabase/server', () => ({ createClient: state.cookie, createServiceClient: state.source }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: state.effective }))
vi.mock('@/lib/admin/chat-context', () => ({ adminChatContext: state.context }))
vi.mock('@/lib/data/stripe-connect-runtime', () => ({ readOwnedStripeOwnerState: state.read, claimOwnedStripeOAuth: state.claim, refuseOwnedStripeOAuth: state.refuse, connectOwnedStripe: state.connect, disconnectOwnedStripe: state.disconnect,
  readOwnedStripeCurrency: state.currency, readOwnedStripeConnection: state.connection, readOwnedStripeAvailability: state.available, readOwnedStripeFeature: state.feature }))
vi.mock('@/lib/stripe', () => ({ stripe: { oauth: { token: state.token, deauthorize: state.deauth } } }))
vi.mock('@/lib/xphere/queue', () => ({ enqueueXphereSync: state.enqueue }))
vi.mock('@/lib/tenant-effects/publish-pending', () => ({ publishPendingNativeTenantEffects: state.publish }))
vi.mock('next/headers', () => ({ headers: state.headers }))
vi.mock('@/lib/auth/identity-services', () => ({ getIdentityServices: () => ({ config: { origin:'https://fixture.invalid' }, store: { session: state.session } }) }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
import { signOwnedStripeState, verifyOwnedStripeState } from '@/lib/stripe-owned-state'
import { GET as start } from '@/app/api/stripe/connect/oauth/route'
import { GET as finish } from '@/app/api/stripe/connect/callback/route'
import { POST as stop } from '@/app/api/stripe/connect/disconnect/route'
const token = randomBytes(32).toString('base64url'), sessionHash = createHash('sha256').update(token).digest('hex')
const tenantId = randomUUID(), actorId = randomUUID(), context = { actorId, tenantId, role: 'store-admin' as const, sessionHash }
const request = (signed = signOwnedStripeState(actorId, tenantId)) => new Request(`http://localhost/api/stripe/connect/callback?code=offline-code&state=${encodeURIComponent(signed)}`)
beforeEach(() => {
  vi.stubEnv('OWNED_AUTH_ENABLED','true'); state.headers.mockResolvedValue(new Headers({cookie:`__Host-xm_identity=${token}`})); state.session.mockResolvedValue({userId:actorId,authenticatedAt:new Date()})
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); vi.stubEnv('OAUTH_STATE_SECRET', randomBytes(32).toString('hex'))
  vi.stubEnv('STRIPE_SECRET_KEY', randomUUID()); vi.stubEnv('STRIPE_CLIENT_ID', 'ca_fixture'); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://fixture.invalid')
  state.effective.mockResolvedValue({ tenantId, role: 'store-admin' }); state.context.mockResolvedValue(context)
  state.read.mockResolvedValue({ tenantId, feature: true, connection: null })
  state.claim.mockImplementation(async () => { state.order.push('claim'); return 'claimed' })
  state.token.mockImplementation(async () => { state.order.push('provider'); return { stripe_user_id: 'acct_fixture', scope: 'read_write' } })
  state.connect.mockImplementation(async () => { state.order.push('commit') })
  state.publish.mockImplementation(async () => { state.order.push('queue'); return {queued:true} })
  state.disconnect.mockImplementation(async () => { state.order.push('disconnect'); return { accountId: 'acct_fixture' } })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); state.order.length = 0 })
it('owned initiation signs the current actor/tenant before redirecting without a Source SDK', async () => {
  const response = await start(new Request('http://localhost/api/stripe/connect/oauth'), undefined), url = new URL(response.headers.get('location')!)
  expect(url.origin).toBe('https://connect.stripe.com'); expect(verifyOwnedStripeState(url.searchParams.get('state')!)).toMatchObject({ actorId, tenantId })
  expect(url.searchParams.get('scope')).toBe('read_write'); expect(state.read).toHaveBeenCalledWith(context)
  expect(state.source).not.toHaveBeenCalled(); expect(state.cookie).not.toHaveBeenCalled()
})
it('callback rejects a different actor/tenant or invalid signature before provider/SQL writes', async () => {
  for (const signed of [signOwnedStripeState(randomUUID(), tenantId), signOwnedStripeState(actorId, randomUUID()), 'invalid-state']) {
    const response = await finish(request(signed), undefined)
    expect(response.headers.get('location')).toContain('stripe=invalid_state')
  }
  expect(state.token).not.toHaveBeenCalled(); expect(state.connect).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('callback exchanges once with bounded options, persists only account ID and queues after commit', async () => {
  const response = await finish(request(), undefined)
  expect(response.headers.get('location')).toContain('stripe=connected')
  expect(state.token).toHaveBeenCalledWith({ grant_type: 'authorization_code', code: 'offline-code' }, { timeout: 6000, maxNetworkRetries: 0 })
  expect(state.connect).toHaveBeenCalledWith(context, 'acct_fixture', expect.objectContaining({ nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/), codeHash: expect.stringMatching(/^[a-f0-9]{64}$/) }))
  expect(state.order).toEqual(['claim','provider','commit','queue'])
  expect(state.source).not.toHaveBeenCalled(); expect(state.cookie).not.toHaveBeenCalled()
})
it('read-only or missing OAuth scope consumes the attempt without connection, CRM or a second exchange', async () => {
  for (const scope of ['read_only', undefined]) {
    let refused = false
    state.claim.mockImplementation(async () => refused ? 'refused' : 'claimed')
    state.refuse.mockImplementation(async () => { refused = true })
    state.token.mockResolvedValue({ stripe_user_id: 'acct_fixture', scope })
    const callback = request(), before = state.token.mock.calls.length
    expect((await finish(callback, undefined)).headers.get('location')).toContain('stripe=exchange_failed')
    expect(state.refuse).toHaveBeenLastCalledWith(context, expect.any(Object), 'acct_fixture')
    expect((await finish(new Request(callback.url), undefined)).headers.get('location')).toContain('stripe=invalid_state')
    expect(state.token.mock.calls.length).toBe(before + 1)
  }
  expect(state.connect).not.toHaveBeenCalled(); expect(state.enqueue).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('missing principal/staff/current SQL denial fails before exchange without Source fallback', async () => {
  state.effective.mockResolvedValue(null); expect((await start(new Request('http://localhost/api/stripe/connect/oauth'), undefined)).headers.get('location')).toContain('/auth/login')
  state.effective.mockResolvedValue({ tenantId, role: 'store-staff' }); expect((await start(new Request('http://localhost/api/stripe/connect/oauth'), undefined)).status).toBe(403)
  state.effective.mockResolvedValue({ tenantId, role: 'store-admin' }); state.read.mockRejectedValue(new AdminMenuError(403, 'Forbidden'))
  expect((await finish(request(), undefined)).status).toBe(403)
  expect(state.token).not.toHaveBeenCalled(); expect(state.cookie).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('post-exchange SQL refusal never reports success, queues or falls back', async () => {
  state.connect.mockRejectedValue(new AdminMenuError(503, 'unavailable'))
  expect((await finish(request(), undefined)).headers.get('location')).toContain('stripe=db_error')
  expect(state.enqueue).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
  expect(state.refuse).toHaveBeenCalledWith(context, expect.any(Object), 'acct_fixture')
})
it('completed, concurrent or uncertain callback deliveries never exchange a consumed code again', async () => {
  for (const claimed of ['connected','refused']) {
    state.claim.mockResolvedValue(claimed)
    await finish(request(), undefined)
    expect(state.token).not.toHaveBeenCalled(); expect(state.connect).not.toHaveBeenCalled(); expect(state.enqueue).not.toHaveBeenCalled()
  }
})
it('an uncertain claim commit stops before exchange, and revoked authority after exchange never persists success', async () => {
  state.claim.mockRejectedValueOnce(new AdminMenuError(503, 'unavailable'))
  expect((await finish(request(), undefined)).status).toBe(503); expect(state.token).not.toHaveBeenCalled()
  state.claim.mockResolvedValue('claimed'); state.connect.mockRejectedValue(new AdminMenuError(403, 'Forbidden'))
  expect((await finish(request(), undefined)).status).toBe(403)
  expect(state.refuse).toHaveBeenCalledOnce(); expect(state.enqueue).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('a revoked browser session after token exchange cannot persist Connect or queue CRM', async () => {
  state.session.mockResolvedValueOnce({userId:actorId,authenticatedAt:new Date()}).mockResolvedValueOnce(null)
  const response=await finish(request(),undefined)
  expect(response.status).toBe(403);expect(state.token).toHaveBeenCalledOnce();expect(state.connect).not.toHaveBeenCalled()
  expect(state.refuse).toHaveBeenCalledOnce();expect(state.publish).not.toHaveBeenCalled();expect(state.source).not.toHaveBeenCalled()
})
it('queue publication failure cannot turn a committed Connect/disconnect into a failed financial response', async () => {
  state.publish.mockRejectedValue(new Error('synthetic queue unavailable'))
  expect((await finish(request(),undefined)).headers.get('location')).toContain('stripe=connected')
  expect(state.connect).toHaveBeenCalledOnce()
  const response=await stop(new Request('http://localhost/api/stripe/connect/disconnect',{method:'POST'}),undefined)
  expect(await response.json()).toEqual({success:true,disconnected:true})
  expect(state.enqueue).not.toHaveBeenCalled();expect(state.source).not.toHaveBeenCalled()
})
it('a token timeout is marked uncertain and its duplicate refuses before the provider', async () => {
  const callback = request()
  state.claim.mockResolvedValue('claimed'); state.token.mockRejectedValue(new Error('response uncertain'))
  state.refuse.mockImplementation(async () => { state.claim.mockResolvedValue('refused') })
  expect((await finish(callback, undefined)).headers.get('location')).toContain('stripe=exchange_failed')
  expect((await finish(new Request(callback.url), undefined)).headers.get('location')).toContain('stripe=invalid_state')
  expect(state.token).toHaveBeenCalledOnce(); expect(state.refuse).toHaveBeenCalledOnce(); expect(state.connect).not.toHaveBeenCalled()
})
it('disconnect commits locally before bounded best-effort revoke; failed SQL never revokes', async () => {
  state.deauth.mockImplementation(async () => { state.order.push('revoke'); throw Error('provider unavailable') })
  const response = await stop(new Request('http://localhost/api/stripe/connect/disconnect', { method: 'POST' }), undefined)
  expect(await response.json()).toEqual({ success: true, disconnected: true }); expect(state.order).toEqual(['disconnect','queue','revoke'])
  expect(state.deauth).toHaveBeenCalledWith({ client_id: 'ca_fixture', stripe_user_id: 'acct_fixture' }, { timeout: 6000, maxNetworkRetries: 0 })
  state.deauth.mockClear(); state.disconnect.mockRejectedValue(new AdminMenuError(503, 'unavailable'))
  expect((await stop(new Request('http://localhost/api/stripe/connect/disconnect', { method: 'POST' }), undefined)).status).toBe(503); expect(state.deauth).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('all shared metadata helpers select SQL before an explicitly supplied legacy client and fail closed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stripe')>('@/lib/stripe')
  state.currency.mockResolvedValue('brl'); state.connection.mockResolvedValue(null); state.available.mockResolvedValue({ feature: true, connection: {} }); state.feature.mockResolvedValue(true)
  expect(await actual.getTenantCurrency(tenantId, {} as never)).toBe('brl'); expect(await actual.getStripeConnection(tenantId, {} as never)).toBeNull()
  expect(await actual.isStripeEnabled(tenantId, {} as never)).toBe(true); expect(await actual.hasStripeConnectFeature(tenantId, {} as never)).toBe(true)
  state.available.mockRejectedValue(new AdminMenuError(503, 'unavailable')); await expect(actual.isStripeEnabled(tenantId)).rejects.toMatchObject({ status: 503 })
  expect(state.source).not.toHaveBeenCalled()
})
