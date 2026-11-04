import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AdminMenuError } from '@/lib/data/admin-menus'
const state = vi.hoisted(() => ({ source: vi.fn(), cookie: vi.fn(), effective: vi.fn(), actor: vi.fn(), super: vi.fn(), read: vi.fn(), page: vi.fn(), superRead: vi.fn(), change: vi.fn(), portal: vi.fn(), queue: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source, createClient: state.cookie }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: state.effective }))
vi.mock('@/lib/admin/chat-context', () => ({ adminChatContext: state.actor }))
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
const tenantId = randomUUID(), actorId = randomUUID(), plan = randomUUID(), context = { tenantId, actorId, role: 'store-admin' as const }
const request = (body: unknown) => new NextRequest('http://localhost/api/tenant/subscription', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
  state.effective.mockResolvedValue({ tenantId, role: 'store-admin' }); state.actor.mockResolvedValue(context)
  state.super.mockResolvedValue({ principal: { userId: actorId } }); state.read.mockResolvedValue({ subscription: null }); state.superRead.mockResolvedValue({ id: null })
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
  expect(state.superRead).toHaveBeenCalledWith({ actorId, tenantId, role: 'superadmin' })
  await superPut(request({ override_monthly_price: 0, override_notes: null }), { params: Promise.resolve({ id: tenantId }) })
  expect(state.change).toHaveBeenLastCalledWith({ actorId, tenantId, role: 'superadmin' }, expect.objectContaining({ mode: 'admin', patch: { override_monthly_price: 0, override_notes: null } }), expect.any(Object))
  expect(state.source).not.toHaveBeenCalled()
})
it('missing/staff actors and native denial never reach provider operations or Source fallback', async () => {
  state.effective.mockResolvedValue(null); expect((await checkout(request({}), undefined)).status).toBe(401)
  state.effective.mockResolvedValue({ tenantId, role: 'store-staff' }); state.actor.mockResolvedValue({ ...context, role: 'store-staff' })
  expect((await PATCH(request({ billing_cycle: 'annual' }), undefined)).status).toBe(403)
  expect(state.change).not.toHaveBeenCalled(); expect(state.cookie).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('ambiguous financial/native failure propagates without success, CRM or Source writes', async () => {
  state.change.mockRejectedValue(new AdminMenuError(503, 'Billing requires reconciliation'))
  expect((await superPut(request({ status: 'active' }), { params: Promise.resolve({ id: tenantId }) })).status).toBe(503)
  expect(state.queue).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('existing superadmin cache/CRM intents occur only after the native operation commits', async () => {
  state.change.mockResolvedValue({ body: { status: 'active' }, sync: { tenantId, reason: 'plan_changed' }, slug: 'tenant-fixture' })
  expect((await superPut(request({ status: 'active' }), { params: Promise.resolve({ id: tenantId }) })).status).toBe(200)
  expect(state.queue).toHaveBeenCalledWith(tenantId, 'plan_changed'); expect(state.revalidate).toHaveBeenCalledWith('/tenant-fixture', 'layout')
})
