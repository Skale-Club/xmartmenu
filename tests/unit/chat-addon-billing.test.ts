import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
const state = vi.hoisted(() => ({ effective: vi.fn(), superadmin: vi.fn(), context: vi.fn(), source: vi.fn(), read: vi.fn(), override: vi.fn(), checkout: vi.fn(), list: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: state.effective }))
vi.mock('@/lib/superadmin-auth', () => ({ assertSuperadmin: state.superadmin }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/admin/chat-context', () => ({ adminChatContext: state.context, adminChatError: (error: unknown) => new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unavailable' }), { status: error instanceof AdminMenuError ? error.status : 503 }) }))
vi.mock('@/lib/data/chat-addon-billing-runtime', () => ({ readOwnedChatAddonBilling: state.read, writeOwnedChatAddonOverride: state.override }))
vi.mock('@/lib/stripe', () => ({ stripe: { checkout: { sessions: { create: state.checkout } }, subscriptions: { list: state.list, update: state.update } } }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
import { createOwnedChatAddonCheckout, cancelOwnedChatAddon } from '@/lib/billing/chat-addon-native'
import { GET as checkoutGet, POST as checkoutPost } from '@/app/api/admin/chat-addon/billing/checkout/route'
import { POST as override } from '@/app/api/superadmin/tenants/[id]/chat-addon-override/route'
const tenantId = randomUUID(), actorId = randomUUID(), priceId = randomUUID(), customerId = randomUUID(), context = { tenantId, actorId, role: 'store-admin' as const }
beforeEach(() => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); vi.stubEnv('STRIPE_CHAT_ADDON_PRICE_ID', priceId); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test')
  state.effective.mockResolvedValue(context); state.context.mockResolvedValue(context); state.superadmin.mockResolvedValue({ mode: 'owned', principal: { userId: actorId } })
  state.read.mockResolvedValue({ status: { available: true }, active: false, customerId }); state.checkout.mockResolvedValue({ url: 'https://checkout.example.test/session' }); state.update.mockResolvedValue({})
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
it('native checkout preserves trusted metadata/price/customer/URLs and completes SQL admission before Stripe', async () => {
  const order: string[] = []
  state.read.mockImplementation(async () => { order.push('read'); return { status: { available: true }, active: false, customerId } })
  state.checkout.mockImplementation(async () => { order.push('stripe'); return { url: 'https://checkout.example.test/session' } })
  expect(await createOwnedChatAddonCheckout(context)).toEqual({ url: 'https://checkout.example.test/session' }); expect(order).toEqual(['read', 'stripe'])
  expect(state.read).toHaveBeenCalledWith(context, true)
  expect(state.checkout).toHaveBeenCalledWith({ mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }], customer: customerId, metadata: { tenant_id: tenantId, addon: 'chat' }, subscription_data: { metadata: { tenant_id: tenantId, addon: 'chat' } }, success_url: 'https://example.test/settings/chat?addon=success', cancel_url: 'https://example.test/settings/chat?addon=cancelled' })
})
it('unavailable plans, missing price and already-active addons refuse before creating checkout', async () => {
  state.read.mockResolvedValueOnce({ status: { available: false }, active: false, customerId }); await expect(createOwnedChatAddonCheckout(context)).rejects.toMatchObject({ status: 403 })
  vi.stubEnv('STRIPE_CHAT_ADDON_PRICE_ID', ''); await expect(createOwnedChatAddonCheckout(context)).rejects.toMatchObject({ status: 503 }); vi.stubEnv('STRIPE_CHAT_ADDON_PRICE_ID', priceId)
  state.read.mockResolvedValueOnce({ status: { available: true }, active: true, customerId }); await expect(createOwnedChatAddonCheckout(context)).rejects.toMatchObject({ status: 409 }); expect(state.checkout).not.toHaveBeenCalled()
})
it('cancellation keeps access until period end and cancels every active chat duplicate but no plan subscription', async () => {
  state.read.mockResolvedValue({ status: null, active: false, customerId })
  const first = randomUUID(), second = randomUUID(), plan = randomUUID()
  state.list.mockResolvedValue({ data: [{ id: first, metadata: { addon: 'chat' } }, { id: plan, metadata: { kind: 'plan' } }, { id: second, metadata: { addon: 'chat' } }] })
  expect(await cancelOwnedChatAddon(context)).toEqual({ ok: true }); expect(state.read).toHaveBeenCalledWith(context, false)
  expect(state.list).toHaveBeenCalledWith({ customer: customerId, status: 'active', limit: 100 }); expect(state.update.mock.calls).toEqual([[first, { cancel_at_period_end: true }], [second, { cancel_at_period_end: true }]])
  expect(state.override).not.toHaveBeenCalled()
})
it('missing customer/addon cancellation returns the existing errors without mutating subscriptions', async () => {
  state.read.mockResolvedValueOnce({ customerId: null }); await expect(cancelOwnedChatAddon(context)).rejects.toMatchObject({ status: 400 }); expect(state.list).not.toHaveBeenCalled()
  state.list.mockResolvedValue({ data: [] }); await expect(cancelOwnedChatAddon(context)).rejects.toMatchObject({ status: 404 }); expect(state.update).not.toHaveBeenCalled()
})
it('provider failures propagate without native SQL retries, Source fallback or invented success', async () => {
  state.checkout.mockRejectedValue(new Error('Mock provider failure'))
  await expect(createOwnedChatAddonCheckout(context)).rejects.toThrow('Mock provider failure'); expect(state.checkout).toHaveBeenCalledTimes(1); expect(state.read).toHaveBeenCalledTimes(1); expect(state.source).not.toHaveBeenCalled()
})
it('native checkout GET redirects successful results and leaves error response bodies readable', async () => {
  const response = await checkoutGet(new Request('http://localhost/api/admin/chat-addon/billing/checkout'), undefined)
  expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('https://checkout.example.test/session')
  state.read.mockResolvedValue({ status: { available: true }, active: true, customerId })
  const rejected = await checkoutGet(new Request('http://localhost/api/admin/chat-addon/billing/checkout'), undefined)
  expect(rejected.status).toBe(409); expect(await rejected.json()).toEqual({ error: 'The AI Chat Addon is already active.' }); expect(state.source).not.toHaveBeenCalled()
})
it('native deny/failure never enters Source and owned principal denial prevents provider work', async () => {
  state.read.mockRejectedValueOnce(new AdminMenuError(503, 'Unavailable'))
  expect((await checkoutPost(new Request('http://localhost'), undefined)).status).toBe(503)
  state.context.mockRejectedValue(new AdminMenuError(401, 'Unauthorized'))
  expect((await checkoutPost(new Request('http://localhost'), undefined)).status).toBe(401); expect(state.checkout).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('native override passes only the verified superadmin UID, fixed target tenant and tri-state value', async () => {
  state.override.mockResolvedValue({ ok: true })
  const response = await override(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ override: null, actor_id: randomUUID(), chat_addon_active: true }) }), { params: Promise.resolve({ id: tenantId }) })
  expect(response.status).toBe(200); expect(state.override).toHaveBeenCalledWith({ actorId, role: 'superadmin', tenantId }, null); expect(state.source).not.toHaveBeenCalled()
})
