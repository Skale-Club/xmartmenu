/**
 * Who pays for AI, against the real app + database and a fake OpenRouter
 * (tests/e2e/mock-openrouter.mjs): the global key as default and fallback,
 * the client's own key, the margin on billable calls, and who may change what.
 *
 * The AI call used is the owner's menu translation (one completion per call).
 * Every call's real cost lands in ai_usage_events; that ledger is what the
 * monthly Stripe line is built from.
 */
import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { db } from '../fixtures/db'
import { TENANTS, storageStatePath, type UserKey } from '../fixtures/seed'

const MOCK = 'http://localhost:3199'
const COST = 0.001
const TENANT = TENANTS.menu.id
const PLATFORM_KEY = 'sk-test-platform-0001'
const CLIENT_KEY = 'sk-test-client-0001'

test.describe.configure({ mode: 'serial' })

let owner: APIRequestContext
let staff: APIRequestContext
let superadmin: APIRequestContext

const as = (user: UserKey, baseURL: string | undefined) => request.newContext({ baseURL, storageState: storageStatePath(user) })

async function mockCalls(): Promise<Array<{ path: string; key: string }>> {
  return (await (await fetch(`${MOCK}/__calls`)).json()).calls
}

async function translate() {
  await fetch(`${MOCK}/__reset`, { method: 'POST' })
  const since = new Date().toISOString()
  const response = await owner.post('/api/admin/translate', {
    data: { from: 'en', to: ['es'], items: { name: 'Classic Burger' } },
  })
  expect(response.status(), await response.text()).toBe(200)
  expect((await response.json()).translations).toEqual({ es: { name: '[es] Classic Burger' } })
  const { data, error } = await db()
    .from('ai_usage_events')
    .select('feature, key_source, billable, cost_usd, markup_pct, charge_usd')
    .eq('tenant_id', TENANT)
    .gte('occurred_at', since)
    .order('id')
  if (error) throw error
  return { events: (data ?? []).map(e => ({ ...e, cost_usd: Number(e.cost_usd), charge_usd: Number(e.charge_usd), markup_pct: Number(e.markup_pct) })), keys: (await mockCalls()).filter(c => c.path === '/chat/completions').map(c => c.key) }
}

async function setClient(body: Record<string, unknown>) {
  const response = await superadmin.put(`/api/superadmin/tenants/${TENANT}/ai`, { data: body })
  expect(response.status(), await response.text()).toBe(200)
  return response.json()
}

test.beforeAll(async ({}, testInfo) => {
  const { baseURL } = testInfo.project.use
  owner = await as('menuOwner', baseURL)
  staff = await as('waiterStaff', baseURL)
  superadmin = await as('superadmin', baseURL)
  await db().from('tenant_ai_settings').delete().eq('tenant_id', TENANT)
})

test.afterAll(async () => {
  await db().from('tenant_ai_settings').delete().eq('tenant_id', TENANT)
  await db().from('platform_ai_settings').update({ openrouter_api_key: null, default_billing_mode: 'platform', default_markup_pct: 30 }).eq('id', 1)
  await Promise.all([owner?.dispose(), staff?.dispose(), superadmin?.dispose()])
})

test('only the superadmin sets the global key, and it never comes back in clear', async () => {
  expect((await owner.put('/api/superadmin/ai/settings', { data: { openrouter_api_key: 'sk-test-hijack' } })).status()).toBe(401)

  const response = await superadmin.put('/api/superadmin/ai/settings', {
    data: { openrouter_api_key: PLATFORM_KEY, default_billing_mode: 'platform', default_markup_pct: 30, usd_to_brl: 5.5 },
  })
  expect(response.status(), await response.text()).toBe(200)
  const text = await response.text()
  expect(text).not.toContain(PLATFORM_KEY)
  const body = JSON.parse(text)
  expect(body.settings).toMatchObject({ key_source: 'panel', default_billing_mode: 'platform', default_markup_pct: 30 })
  expect(body.settings.openrouter_api_key).toContain('••')

  const { data } = await db().from('platform_ai_settings').select('openrouter_api_key').eq('id', 1).single()
  expect(data?.openrouter_api_key).toBeTruthy()
  expect(data?.openrouter_api_key).not.toContain('sk-test')
})

test('staff cannot see or change the AI key', async () => {
  expect((await staff.get('/api/admin/ai')).status()).toBe(403)
  expect((await staff.put('/api/admin/ai', { data: { openrouter_api_key: 'sk-test-x' } })).status()).toBe(403)
})

test('platform default: our key, billed at cost + margin', async () => {
  const { events, keys } = await translate()
  expect(keys).toEqual([PLATFORM_KEY])
  expect(events).toEqual([{ feature: 'translation', key_source: 'platform', billable: true, cost_usd: COST, markup_pct: 30, charge_usd: 0.0013 }])
})

test("owner's own key: they pay OpenRouter, we bill nothing", async () => {
  const saved = await owner.put('/api/admin/ai', { data: { openrouter_api_key: CLIENT_KEY } })
  expect(saved.status(), await saved.text()).toBe(200)
  expect(await saved.json()).toMatchObject({ effective_mode: 'own_key' })

  const { events, keys } = await translate()
  expect(keys).toEqual([CLIENT_KEY])
  expect(events).toEqual([{ feature: 'translation', key_source: 'tenant', billable: false, cost_usd: COST, markup_pct: 0, charge_usd: 0 }])
})

test('client key out of credit: falls back to our key, billed with the client margin, and flags the key', async () => {
  await setClient({ openrouter_api_key: 'sk-test-nocredit', markup_pct: 50 })

  const { events, keys } = await translate()
  expect(keys).toEqual(['sk-test-nocredit', PLATFORM_KEY])
  expect(events).toEqual([{ feature: 'translation', key_source: 'platform', billable: true, cost_usd: COST, markup_pct: 50, charge_usd: 0.0015 }])

  const mine = await (await owner.get('/api/admin/ai')).json()
  expect(mine.last_key_error).toMatch(/402/)
  const admin = await (await superadmin.get(`/api/superadmin/tenants/${TENANT}/ai`)).json()
  expect(admin).toMatchObject({ effective_mode: 'own_key', effective_markup_pct: 50 })
  expect(admin.last_key_error).toMatch(/402/)
  expect(admin.unbilled_charge_usd).toBeGreaterThan(0)
})

test('included: our key, never billed', async () => {
  await setClient({ billing_mode: 'included' })
  const { events, keys } = await translate()
  expect(keys).toEqual([PLATFORM_KEY])
  expect(events).toEqual([{ feature: 'translation', key_source: 'platform', billable: false, cost_usd: COST, markup_pct: 0, charge_usd: 0 }])
})

test('key test reports a rejected key', async () => {
  const response = await owner.post('/api/admin/ai', { data: { action: 'test', api_key: 'sk-test-invalid' } })
  expect(await response.json()).toMatchObject({ ok: false, status: 401 })
  const good = await superadmin.post('/api/superadmin/ai/settings', { data: { action: 'test' } })
  expect(await good.json()).toMatchObject({ ok: true })
})

test('bill now needs a card on file (Stripe customer)', async () => {
  const response = await superadmin.post(`/api/superadmin/tenants/${TENANT}/ai`, { data: { action: 'bill' } })
  expect(response.status(), await response.text()).toBe(200)
  expect(await response.json()).toMatchObject({ billed: false, reason: 'no_stripe_customer' })
})
