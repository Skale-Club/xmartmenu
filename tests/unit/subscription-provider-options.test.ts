import { afterEach, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ account: vi.fn(), balance: vi.fn(), sub: vi.fn(), checkout: vi.fn(), create: vi.fn(), update: vi.fn(), expire: vi.fn(), portal: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ stripe: { accounts: { retrieve: calls.account }, balance: { retrieve: calls.balance }, subscriptions: { retrieve: calls.sub, update: calls.update }, checkout: { sessions: { retrieve: calls.checkout, create: calls.create, expire: calls.expire } }, billingPortal: { sessions: { create: calls.portal } } } }))
import { subscriptionGateway } from '@/lib/billing/subscription-provider'
afterEach(() => vi.resetAllMocks())
it('every native provider request pins version, six-second timeout and zero automatic retries', async () => {
  calls.account.mockResolvedValue({ id: 'acct_fixture' }); calls.balance.mockResolvedValue({ livemode: false })
  await subscriptionGateway.context(); await subscriptionGateway.subscription('sub_fixture'); await subscriptionGateway.checkout('cs_fixture')
  await subscriptionGateway.createCheckout({ mode: 'subscription' }, 'request-fixture'); await subscriptionGateway.updateSubscription('sub_fixture', {}, 'request-fixture')
  await subscriptionGateway.expireCheckout('cs_fixture', 'request-fixture'); await subscriptionGateway.portal('cus_fixture', 'https://fixture.invalid/settings/subscription')
  const options = { timeout: 6000, maxNetworkRetries: 0, apiVersion: '2026-04-22.dahlia' }
  expect(calls.account).toHaveBeenCalledWith(null, {}, options); expect(calls.balance).toHaveBeenCalledWith({}, options)
  expect(calls.sub).toHaveBeenCalledWith('sub_fixture', {}, options); expect(calls.checkout).toHaveBeenCalledWith('cs_fixture', { expand: ['line_items.data.price'] }, options)
  expect(calls.create).toHaveBeenCalledWith({ mode: 'subscription' }, { ...options, idempotencyKey: 'request-fixture' })
  expect(calls.update).toHaveBeenCalledWith('sub_fixture', {}, { ...options, idempotencyKey: 'request-fixture' })
  expect(calls.expire).toHaveBeenCalledWith('cs_fixture', {}, { ...options, idempotencyKey: 'request-fixture' })
  expect(calls.portal).toHaveBeenCalledWith({ customer: 'cus_fixture', return_url: 'https://fixture.invalid/settings/subscription' }, options)
})
