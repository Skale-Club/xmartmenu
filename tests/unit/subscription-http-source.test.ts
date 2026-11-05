import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AdminMenuError } from '@/lib/data/admin-menus'
const state = vi.hoisted(() => ({ source: vi.fn(), cookie: vi.fn(), effective: vi.fn(), principal: vi.fn(), headers: vi.fn(), super: vi.fn(), read: vi.fn(), page: vi.fn(), superRead: vi.fn(), change: vi.fn(), portal: vi.fn(), queue: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source, createClient: state.cookie }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: state.effective }))
vi.mock('@/lib/auth/owned-principal-runtime', () => ({ getOwnedPrincipal: state.principal }))
vi.mock('@/lib/auth/identity-services', () => ({ getIdentityServices: () => ({ config: { origin: 'https://fixture.invalid' } }) }))
vi.mock('next/headers', () => ({ headers: state.headers }))
vi.mock('@/lib/superadmin-auth', () => ({ assertSuperadmin: state.super }))
vi.mock('@/lib/data/subscription-billing-runtime', () => ({ readOwnedSubscriptionApi: state.read, readOwnedSubscriptionPage: state.page, readOwnedSuperSubscription: state.superRead, subscriptionTransactions: {} }))
vi.mock('@/lib/billing/subscription-native', () => ({ changeNativeSubscription: state.change, nativeSubscriptionPortal: state.portal }))
vi.mock('@/lib/billing/subscription-provider', () => ({ subscriptionGateway: {} }))
vi.mock('@/lib/xphere/queue', () => ({ enqueueXphereSync: state.queue }))
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
import { GET, PATCH } from '@/app/api/tenant/subscription/route'
import { POST as checkout } from '@/app/api/tenant/subscription/checkout/route'
import { POST as portal } from '@/app/api/tenant/subscription/portal/route'
import { GET as superGet, PUT as superPut } from '@/app/api/superadmin/tenants/[id]/subscription/route'
import Page from '@/app/(admin)/settings/subscription/page'
const token = randomBytes(32).toString('base64url'), sessionHash = createHash('sha256').update(token).digest('hex')
const tenantId = randomUUID(), actorId = randomUUID(), plan = randomUUID(), context = { tenantId, actorId, role: 'store-admin' as const, sessionHash }
const request = (body: unknown) => new NextRequest('http://localhost/api/tenant/subscription', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'http://localhost' } })
beforeEach(() => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
  vi.stubEnv('OWNED_AUTH_ENABLED', 'true')
  state.effective.mockResolvedValue({ tenantId, role: 'store-admin' }); state.principal.mockResolvedValue({ userId: actorId, tenantId, role: 'store-admin' })
  state.headers.mockResolvedValue(new Headers({ cookie: `__Host-xm_identity=${token}` }))
  state.super.mockImplementation(async () => { const principal = { userId: actorId, role: 'superadmin', tenantId: null }; state.principal.mockResolvedValue(principal); return { mode: 'owned', principal } })
  state.read.mockResolvedValue({ subscription: null }); state.superRead.mockResolvedValue({ id: null })
  state.page.mockResolvedValue({ subscription: null, plan: null, plans: [], stripeEnabled: false, stripeAccountId: null })
  state.change.mockResolvedValue({ body: { success: true } }); state.portal.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/fixture' })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
it('tenant GET and SSR use the current actor and native snapshot before any Source constructor', async () => {
  expect((await GET(request({}), undefined)).status).toBe(200)
  await Page({ searchParams: Promise.resolve({}) })
  expect(state.read).toHaveBeenCalledWith(context); expect(state.page).toHaveBeenCalledWith(context)
  expect(state.cookie).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('checkout ignores forged tenant/customer IDs and preserves cycle/default-current-plan semantics', async () => {
  await checkout(request({ tenant_id: randomUUID(), customer: 'cus_forged', plan_id: plan, billing_cycle: 'annual' }), undefined)
  expect(state.change).toHaveBeenCalledWith(context, { mode: 'checkout', planId: plan, cycle: 'annual' }, expect.any(Object))
  expect(state.cookie).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('owner cycle/portal and superadmin read/write use distinct native operations', async () => {
  await PATCH(request({ billing_cycle: 'monthly' }), undefined); expect(state.change).toHaveBeenCalledWith(context, { mode: 'cycle', cycle: 'monthly' }, expect.any(Object))
  expect((await portal(request({}), undefined)).status).toBe(200)
  await superGet(request({}), { params: Promise.resolve({ id: tenantId }) })
  expect(state.superRead).toHaveBeenCalledWith({ actorId, tenantId, role: 'superadmin', sessionHash })
  await superPut(request({ override_monthly_price: 0, override_notes: null }), { params: Promise.resolve({ id: tenantId }) })
  expect(state.change).toHaveBeenLastCalledWith({ actorId, tenantId, role: 'superadmin', sessionHash }, expect.objectContaining({ mode: 'admin', patch: { override_monthly_price: 0, override_notes: null } }), expect.any(Object))
  expect(state.source).not.toHaveBeenCalled()
})
it('missing/staff actors and native denial never reach provider operations or Source fallback', async () => {
  state.effective.mockResolvedValue(null); expect((await checkout(request({}), undefined)).status).toBe(401)
  state.effective.mockResolvedValue({ tenantId, role: 'store-staff' }); state.principal.mockResolvedValue({ userId: actorId, tenantId, role: 'store-staff' })
  expect((await PATCH(request({ billing_cycle: 'annual' }), undefined)).status).toBe(403)
  expect(state.change).not.toHaveBeenCalled(); expect(state.cookie).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('ambiguous financial/native failure propagates without success, CRM or Source writes', async () => {
  state.change.mockRejectedValue(new AdminMenuError(503, 'Billing requires reconciliation'))
  expect((await superPut(request({ status: 'active' }), { params: Promise.resolve({ id: tenantId }) })).status).toBe(503)
  expect(state.queue).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('superadmin cache invalidation follows the commit without handing off to the legacy CRM worker', async () => {
  state.change.mockResolvedValue({ body: { status: 'active' }, sync: { tenantId, reason: 'plan_changed' }, slug: 'tenant-fixture' })
  expect((await superPut(request({ status: 'active' }), { params: Promise.resolve({ id: tenantId }) })).status).toBe(200)
  expect(state.queue).not.toHaveBeenCalled(); expect(state.revalidate).toHaveBeenCalledWith('/tenant-fixture', 'layout')
})
it('post-commit cache failure cannot report a committed charge as a failed billing operation', async () => {
  state.change.mockResolvedValue({ body: { status: 'active' }, sync: { tenantId, reason: 'plan_changed' }, slug: 'tenant-fixture' })
  state.revalidate.mockImplementation(() => { throw Error('cache unavailable') })
  const response = await superPut(request({ status: 'active' }), { params: Promise.resolve({ id: tenantId }) })
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'active' }); expect(state.queue).not.toHaveBeenCalled()
})
it('missing native cookie or native Auth mode denies without Source fallback or provider operations', async () => {
  state.headers.mockResolvedValue(new Headers())
  expect((await checkout(request({}), undefined)).status).toBe(401)
  vi.stubEnv('OWNED_AUTH_ENABLED', 'false')
  expect((await checkout(request({}), undefined)).status).toBe(503)
  expect(state.change).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled(); expect(state.cookie).not.toHaveBeenCalled()
})
it('cross-site cycle, checkout, portal and superadmin mutations refuse before reading authority or producing effects', async () => {
  const crossSite = () => { const value = request({ billing_cycle: 'annual', status: 'active' }); value.headers.set('origin', 'https://foreign.invalid'); return value }
  expect((await PATCH(crossSite(), undefined)).status).toBe(403)
  expect((await checkout(crossSite(), undefined)).status).toBe(403)
  expect((await portal(crossSite(), undefined)).status).toBe(403)
  expect((await superPut(crossSite(), { params: Promise.resolve({ id: tenantId }) })).status).toBe(403)
  expect(state.effective).not.toHaveBeenCalled(); expect(state.principal).not.toHaveBeenCalled(); expect(state.super).not.toHaveBeenCalled()
  expect(state.change).not.toHaveBeenCalled(); expect(state.portal).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('oversized streamed JSON and wrong content type refuse before authority, SQL or provider operations', async () => {
  const tooLarge = request({ override_notes: 'x'.repeat(65536) })
  expect((await superPut(tooLarge, { params: Promise.resolve({ id: tenantId }) })).status).toBe(413)
  const declared = request({}); declared.headers.set('content-length', '65537')
  expect((await checkout(declared, undefined)).status).toBe(413)
  const wrongType = request({ billing_cycle: 'annual' }); wrongType.headers.set('content-type', 'text/plain')
  expect((await PATCH(wrongType, undefined)).status).toBe(400)
  const invalid = new NextRequest('http://localhost/api/tenant/subscription', { method: 'POST', body: '{', headers: { origin: 'http://localhost', 'content-type': 'application/json' } })
  expect((await checkout(invalid, undefined)).status).toBe(400)
  expect(state.effective).not.toHaveBeenCalled(); expect(state.super).not.toHaveBeenCalled(); expect(state.change).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
