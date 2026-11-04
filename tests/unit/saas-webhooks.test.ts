import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { applySaasWebhook } from '@/lib/data/saas-webhooks'
const tenant = randomUUID(), oldPlan = randomUUID(), newPlan = randomUUID()
const event = (type: string, object: unknown) => ({ id: `evt_${randomUUID().replaceAll('-', '')}`, type, data: { object } })
const metadata = { tenant_id: tenant, kind: 'plan' }
it('a duplicate receipt skips business queries and a conflicting receipt type refuses', async () => {
  const input = event('checkout.session.completed', { metadata }), query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ event_type: input.type }] })
  expect(await applySaasWebhook(query, input)).toEqual({ received: true, skipped: true }); expect(query).toHaveBeenCalledTimes(2)
  query.mockReset().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ event_type: 'account.updated' }] })
  await expect(applySaasWebhook(query, input)).rejects.toMatchObject({ status: 503 }); expect(query).toHaveBeenCalledTimes(2)
})
it('plan checkout binds fixed patch fields and returns only the existing post-commit CRM intent', async () => {
  const input = event('checkout.session.completed', { metadata: { ...metadata, plan_id: newPlan }, customer: 'customer-fixture', subscription: 'subscription-fixture' })
  const query = vi.fn().mockResolvedValue({ rows: [] }), result = await applySaasWebhook(query, input)
  expect(result).toEqual({ received: true, pendingSync: { tenantId: tenant, reason: 'plan_activated' } })
  const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE public.tenant_subscriptions'))!
  expect(update[0]).not.toContain(tenant); expect(update[1]).toContain(tenant); expect(update[1]).toContain(newPlan)
  expect(query.mock.calls.at(-1)![0]).toContain('INSERT INTO public.processed_stripe_events')
})
it('subscription change locks the tenant before mutable rows, resolves item periods/annual price and reconciles', async () => {
  const input = event('customer.subscription.updated', { id: 'subscription-fixture', metadata, status: 'trialing', cancel_at_period_end: true, items: { data: [{ current_period_start: 1000, current_period_end: 2000, price: { id: 'price-fixture' } }] } })
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT event_type')) return { rows: [] }
    if (sql.includes('SELECT plan_id')) return { rows: [{ plan_id: oldPlan }] }
    if (sql.includes('stripe_price_annual_id FROM')) return { rows: [{ id: newPlan, stripe_price_annual_id: 'price-fixture' }] }
    if (sql.includes('SELECT id,sort_order')) return { rows: [{ id: oldPlan, sort_order: 1 }, { id: newPlan, sort_order: 2 }] }
    if (sql.includes('SELECT p.id,p.name')) return { rows: [] }
    return { rows: [] }
  })
  const result = await applySaasWebhook(query, input)
  expect(result.pendingSync).toEqual({ tenantId: tenant, reason: 'plan_changed', tags: ['upgrade'] })
  const lock = query.mock.calls.findIndex(([sql]) => sql.startsWith('SELECT id FROM public.tenants'))
  const write = query.mock.calls.findIndex(([sql]) => sql.startsWith('UPDATE public.tenant_subscriptions'))
  expect(lock).toBeGreaterThan(1); expect(write).toBeGreaterThan(lock)
  const values = (query.mock.calls[write] as unknown as [string, unknown[]])[1]
  expect(values).toContain('trial'); expect(values).toContain('annual'); expect(values).toContain(new Date(1000 * 1000).toISOString()); expect(values).toContain(new Date(2000 * 1000).toISOString())
})
it('payout-only account flaps do not disable charging and actual charge-disable returns a post-commit security intent', async () => {
  for (const charges of [true, false]) {
    const query = vi.fn(async (sql: string) => sql.includes('FROM public.stripe_connections') ? { rows: [{ id: randomUUID(), tenant_id: tenant, is_active: true }] } : { rows: [] })
    const result = await applySaasWebhook(query, event('account.updated', { id: 'account-fixture', charges_enabled: charges, payouts_enabled: false }))
    expect(result.pendingSync).toEqual({ tenantId: tenant, reason: 'connect_changed' })
    expect(!!result.disabledAccountId).toBe(!charges)
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE public.stripe_connections'))).toBe(!charges)
  }
})
it('required native invoice billing refuses without a mutation or receipt; unmatched drafts remain harmless no-ops', async () => {
  const input = event('invoice.created', { id: 'invoice-fixture', status: 'draft', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'subscription-fixture' } } })
  const query = vi.fn(async (sql: string) => sql.includes('stripe_subscription_id=$1') ? { rows: [{ tenant_id: tenant }] }
    : sql.startsWith('SELECT stripe_customer_id') ? { rows: [{ stripe_customer_id: 'customer-fixture' }] }
    : sql.includes('FROM public.ai_usage_events') ? { rows: [{ pending: 1 }] } : { rows: [] })
  await expect(applySaasWebhook(query, input)).rejects.toMatchObject({ status: 503 })
  expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false)
  const missing = vi.fn().mockResolvedValue({ rows: [] })
  expect(await applySaasWebhook(missing, input)).toEqual({ received: true })
})
it('ambiguous subscription/price/account mapping and payment-intent misrouting fail before mutation', async () => {
  const duplicate = vi.fn(async (sql: string) => sql.includes('stripe_subscription_id=$1') ? { rows: [{ tenant_id: tenant }, { tenant_id: randomUUID() }] } : { rows: [] })
  await expect(applySaasWebhook(duplicate, event('invoice.payment_failed', { subscription: 'subscription-fixture' }))).rejects.toMatchObject({ status: 503 })
  expect(duplicate.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false)
  const payment = vi.fn(); await expect(applySaasWebhook(payment, event('payment_intent.succeeded', {}))).rejects.toMatchObject({ status: 503 }); expect(payment).not.toHaveBeenCalled()
})
