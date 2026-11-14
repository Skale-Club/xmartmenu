import { randomBytes, randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { NextRequest } from 'next/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
const state = vi.hoisted(() => ({ source: vi.fn(), owned: vi.fn(), raw: vi.fn(), enqueue: vi.fn(), publish: vi.fn(), security: vi.fn(), bill: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/data/saas-webhooks-runtime', () => ({ processOwnedSaasWebhook: state.owned }))
vi.mock('@/lib/stripe', async () => {
  const SDK = (await import('stripe')).default
  return { stripe: { webhooks: { constructEvent: (...args: Parameters<typeof SDK.webhooks.constructEvent>) => { state.raw(...args); return SDK.webhooks.constructEvent(...args) } } } }
})
vi.mock('@/lib/xphere/queue', () => ({ enqueueXphereSync: state.enqueue }))
vi.mock('@/lib/tenant-effects/publish-pending', () => ({ publishPendingNativeTenantEffects: state.publish }))
vi.mock('@/lib/ai/billing', () => ({ billAiUsage: state.bill, subscriptionIdFromInvoice: vi.fn() }))
vi.mock('@/lib/tenant-plan', () => ({ reconcileTenantSettings: vi.fn() }))
vi.mock('@/lib/observability', () => ({ captureSecurityEvent: state.security }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
import { POST } from '@/app/api/stripe/webhooks/route'
const tenant = randomUUID()
let secret: string
beforeEach(() => {
  secret = randomBytes(32).toString('hex'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret)
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); vi.stubEnv('OWNED_ORDER_DATA_ENABLED', 'false'); vi.stubEnv('OWNED_PAYMENT_DATA_ENABLED', 'false')
  state.owned.mockResolvedValue({ received: true }); state.enqueue.mockResolvedValue(undefined); state.publish.mockResolvedValue({queued:true})
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
const payload = (type = 'checkout.session.completed') => ` { "id": "evt_${randomUUID().replaceAll('-', '')}", "type": "${type}", "data": {"object":{"metadata":{"tenant_id":"${tenant}","kind":"plan"}}} } `
const request = (raw: string, signature = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret })) => new NextRequest('http://localhost/api/stripe/webhooks', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } })
it.each([undefined, '', '   '])('rejects an unconfigured webhook secret (%s) before SDK verification or data access', async (configured) => {
  const raw = payload()
  // Reproduce the dangerous case: the SDK itself accepts an empty-key HMAC.
  const forged = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: configured ?? '' })
  if (configured === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
  else vi.stubEnv('STRIPE_WEBHOOK_SECRET', configured)
  const response = await POST(request(raw, forged), undefined)
  expect([400, 401]).toContain(response.status)
  expect(state.raw).not.toHaveBeenCalled()
  expect(state.owned).not.toHaveBeenCalled()
  expect(state.source).not.toHaveBeenCalled()
  expect(state.publish).not.toHaveBeenCalled()
  expect(state.enqueue).not.toHaveBeenCalled()
})
it('verifies byte-exact original raw payload with the actual SDK before native SQL and Source construction', async () => {
  const raw = payload(), response = await POST(request(raw), undefined)
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ received: true })
  expect(state.raw.mock.calls[0][0]).toBe(raw); expect(state.owned.mock.calls[0][0]).toMatchObject({ type: 'checkout.session.completed' }); expect(state.source).not.toHaveBeenCalled()
})
it('missing, stale and tampered signatures refuse before any native mutation', async () => {
  const raw = payload(), signed = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret })
  expect((await POST(request(`${raw} `, signed), undefined)).status).toBe(400)
  expect((await POST(request(raw, Stripe.webhooks.generateTestHeaderString({ payload: raw, secret, timestamp: Math.floor(Date.now() / 1000) - 1000 })), undefined)).status).toBe(400)
  expect((await POST(new NextRequest('http://localhost', { method: 'POST', body: raw }), undefined)).status).toBe(400)
  expect(state.owned).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('post-commit CRM/security intents retain event ID and duplicate receipts emit no intents', async () => {
  const raw = payload('account.updated'), id = JSON.parse(raw).id
  state.owned.mockResolvedValueOnce({ received: true, disabledAccountId: 'account-fixture', pendingSync: { tenantId: tenant, reason: 'connect_changed', tags: ['changed'] } })
  expect((await POST(request(raw), undefined)).status).toBe(200)
  expect(state.owned).toHaveBeenCalledWith(expect.objectContaining({id})); expect(state.publish).toHaveBeenCalledWith(tenant); expect(state.enqueue).not.toHaveBeenCalled(); expect(state.security).toHaveBeenCalledTimes(1)
  state.enqueue.mockClear(); state.publish.mockClear(); state.security.mockClear(); state.owned.mockResolvedValueOnce({ received: true, skipped: true })
  const duplicate = await POST(request(raw), undefined); expect(await duplicate.json()).toEqual({ received: true, skipped: true }); expect(state.enqueue).not.toHaveBeenCalled(); expect(state.publish).not.toHaveBeenCalled(); expect(state.security).not.toHaveBeenCalled()
})
it('native failure or required invoice billing returns retryable failure without Source/billing/enqueue fallback', async () => {
  state.owned.mockRejectedValue(new AdminMenuError(503, 'Native AI invoice settlement is not available'))
  const response = await POST(request(payload('invoice.created')), undefined)
  expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'Processing error' })
  expect(state.bill).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled(); expect(state.enqueue).not.toHaveBeenCalled()
})
it('queue publication failure after the native event commit still acknowledges the signed financial event', async()=>{
  state.owned.mockResolvedValue({received:true,pendingSync:{tenantId:tenant,reason:'plan_activated'}})
  state.publish.mockRejectedValue(new Error('synthetic queue unavailable'))
  const response=await POST(request(payload()),undefined)
  expect(response.status).toBe(200);expect(await response.json()).toEqual({received:true})
  expect(state.publish).toHaveBeenCalledWith(tenant);expect(state.enqueue).not.toHaveBeenCalled();expect(state.source).not.toHaveBeenCalled()
})
it('a genuinely signed connected-account checkout cannot use foreign tenant metadata to mutate platform SaaS in either mode', async () => {
  const connected = JSON.stringify({ ...JSON.parse(payload()), account: 'acct_merchantfixture', livemode: true,
    data: { object: { metadata: { tenant_id: randomUUID(), kind: 'plan', plan_id: randomUUID() }, customer: 'cus_merchantfixture', subscription: 'sub_merchantfixture' } } })
  for (const mode of ['true', 'false']) {
    vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', mode)
    const response = await POST(request(connected), undefined)
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ received: true })
  }
  expect(state.raw).toHaveBeenCalledTimes(2); expect(state.owned).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
  expect(state.bill).not.toHaveBeenCalled(); expect(state.enqueue).not.toHaveBeenCalled(); expect(state.security).not.toHaveBeenCalled()
})
it('connected account.updated requires matching account/object scope and preserves signed account/mode fields', async () => {
  const envelope = { ...JSON.parse(payload('account.updated')), account: 'acct_merchantfixture', livemode: true }
  await POST(request(JSON.stringify({ ...envelope, data: { object: { id: 'acct_otherfixture', charges_enabled: false } } })), undefined)
  expect(state.owned).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
  await POST(request(JSON.stringify({ ...envelope, data: { object: { id: envelope.account, charges_enabled: false } } })), undefined)
  expect(state.owned).toHaveBeenCalledWith(expect.objectContaining({ account: envelope.account, livemode: true, type: 'account.updated' }))
})
