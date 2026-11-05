import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { connectNativeStripe, disconnectNativeStripe, readNativeStripeConnection, readNativeStripeCurrency, readNativeStripeOwnerState } from '@/lib/data/stripe-connect'
const tenantId = randomUUID(), actorId = randomUUID(), planId = randomUUID(), connectionId = randomUUID(), context = { tenantId, actorId, role: 'store-admin' as const, sessionHash: 'a'.repeat(64) }
const time = new Date('2026-11-04T22:00:00Z')
const connection = { id: connectionId, tenant_id: tenantId, stripe_account_id: 'acct_fixture', scope: 'read_write', is_active: true, connected_at: time, disconnected_at: null, created_at: time, updated_at: time }
const plan = { id: planId, name: 'Plan', slug: 'plan', description: null, monthly_price: 20, annual_price: 200, transaction_fee_pct: 3, features: ['payments','stripe-connect'], billing_cycle: 'monthly', status: 'active', override_monthly_price: null, override_annual_price: null, override_transaction_fee_pct: null, override_notes: null }
function query(overrides: { profile?: object; other?: boolean } = {}) {
  return vi.fn(async (sql: string) => {
    if (sql.includes('FROM public.profiles p JOIN public.app_accounts')) return { rows: [{ id: actorId, tenant_id: tenantId, role: 'store-admin', must_change_password: false, disabled_at: null, ...overrides.profile }] }
    if (sql.includes('FROM public.app_sessions s')) return { rows: [{ user_id: actorId }] }
    if (sql.startsWith('SELECT id FROM public.tenants')) return { rows: [{ id: tenantId }] }
    if (sql.includes('SELECT p.id,p.name')) return { rows: [plan] }
    if (sql.includes('stripe_account_id=$1 AND tenant_id<>')) return { rows: overrides.other ? [{ tenant_id: randomUUID() }] : [] }
    if (sql.includes('FROM public.stripe_connections WHERE tenant_id=$1 AND is_active=true')) return { rows: [connection] }
    if (sql.startsWith('UPDATE public.stripe_connections')) return { rows: [{ id: connectionId, stripe_account_id: connection.stripe_account_id }] }
    return { rows: [] }
  })
}
it('active connection reads use exact tenant/active predicates and preserve lifecycle timestamps', async () => {
  const sql = query(), result = await readNativeStripeConnection(sql, tenantId)
  expect(result).toMatchObject({ ...connection, connected_at: time.toISOString(), created_at: time.toISOString(), updated_at: time.toISOString() })
  expect(sql.mock.calls[0][0]).toContain('tenant_id=$1 AND is_active=true LIMIT 2')
  expect(sql.mock.calls[0][0]).not.toContain(tenantId)
})
it('missing and mixed-case currencies retain the USD default and canonical case', async () => {
  for (const [input, expected] of [[null, 'usd'], ['', 'usd'], ['BRL', 'brl']] as const) {
    expect(await readNativeStripeCurrency(vi.fn().mockResolvedValue({ rows: [{ currency: input }] }), tenantId)).toBe(expected)
  }
  await expect(readNativeStripeCurrency(vi.fn().mockResolvedValue({ rows: [{ currency: 'bad-currency' }] }), tenantId)).rejects.toMatchObject({ status: 503 })
})
it('current local disabled/reset/role/tenant controls deny owner reads and mutations', async () => {
  for (const profile of [{ disabled_at: time }, { must_change_password: true }, { role: 'store-staff' }, { tenant_id: randomUUID() }]) {
    const sql = query({ profile })
    await expect(readNativeStripeOwnerState(sql, context)).rejects.toMatchObject({ status: 403 })
    await expect(connectNativeStripe(sql, context, 'acct_fixture', time)).rejects.toMatchObject({ status: 403 })
    expect(sql.mock.calls.some(([text]) => /^(INSERT|UPDATE|DELETE)/.test(text))).toBe(false)
  }
})
it('connection persistence rechecks owner and plan with fixed bound metadata and no provider tokens', async () => {
  const sql = query(); await connectNativeStripe(sql, context, 'acct_fixture', time)
  const insert = sql.mock.calls.find(([text]) => text.startsWith('INSERT INTO public.stripe_connections'))!
  expect(insert[0]).toContain('ON CONFLICT(tenant_id)'); expect(insert[0]).not.toMatch(/access_token|refresh_token|acct_fixture/)
  expect(sql.mock.calls[0][0]).toContain('xmartmenu-account-authority')
  expect(sql.mock.calls.findIndex(([text]) => text.includes('FOR NO KEY UPDATE'))).toBeGreaterThan(sql.mock.calls.findIndex(([text]) => text.includes('FROM public.profiles p JOIN')))
})
it('cross-tenant account ambiguity refuses before persistence', async () => {
  const sql = query({ other: true })
  await expect(connectNativeStripe(sql, context, 'acct_fixture', time)).rejects.toMatchObject({ status: 409 })
  expect(sql.mock.calls.some(([text]) => text.startsWith('INSERT'))).toBe(false)
})
it('disconnect is tenant-scoped, owner-only and remains possible without a paid-plan read', async () => {
  const sql = query(); expect(await disconnectNativeStripe(sql, context, time)).toEqual({ accountId: 'acct_fixture' })
  expect(sql.mock.calls.some(([text]) => text.includes('SELECT p.id,p.name'))).toBe(false)
  const update = sql.mock.calls.find(([text]) => text.startsWith('UPDATE public.stripe_connections'))!
  expect(update[0]).toContain('WHERE tenant_id=$1 AND is_active=true RETURNING')
})
