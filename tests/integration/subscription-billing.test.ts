// Disposable PostgreSQL only. Provider writes/readbacks use an in-memory gateway.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
import { readSubscriptionApi, readSubscriptionPage, readSuperSubscription, subscriptionSnapshot, type SubscriptionActor } from '../../src/lib/data/subscription-billing'
import { changeNativeSubscription, nativeSubscriptionPortal, type SubscriptionDependencies } from '../../src/lib/billing/subscription-native'
import type { SubscriptionGateway } from '../../src/lib/billing/subscription-provider'
import { hashFacts } from '../../src/lib/ai/native-billing-facts'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable subscription target required')
const target = new URL(raw)
if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable subscription target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const run = <T>(write: boolean, op: Parameters<typeof adminMenuTransaction<T>>[2]) => adminMenuTransaction(pool, write, op)
const a = randomUUID(), b = randomUUID(), ownerId = randomUUID(), staffId = randomUUID(), superId = randomUUID(), first = randomUUID(), second = randomUUID()
const owner: SubscriptionActor = { actorId: ownerId, tenantId: a, role: 'store-admin' }, superActor: SubscriptionActor = { actorId: superId, tenantId: a, role: 'superadmin' }
const clock = new Date('2026-11-04T23:00:00Z'), context = { accountId: 'acct_platformfixture', livemode: false, apiVersion: '2026-04-22.dahlia' }
type Row = Record<string, unknown>
const sessions = new Map<string, Row>(), subscriptions = new Map<string, Row>(), responses = new Map<string, { hash: string; value: Row }>()
let creates = 0, updates = 0, expires = 0, mode = '', order: string[] = []
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const subscription = (id: string, price = 'price_first_month', status = 'active'): Row => ({ id, object: 'subscription', customer: 'cus_a', livemode: false, status, metadata: { kind: 'plan', tenant_id: a, plan_id: first }, latest_invoice: null, items: { data: [{ id: 'si_fixture', price: { id: price } }], has_more: false } })
function memo(key: string, body: Row, build: () => Row) {
  const cached = responses.get(key), hash = hashFacts(body)
  if (cached) { assert.equal(cached.hash, hash); return copy(cached.value) }
  const value = build(); responses.set(key, { hash, value: copy(value) }); return copy(value)
}
const gateway: SubscriptionGateway = {
  context: async () => context,
  subscription: async id => { const value = subscriptions.get(id); if (!value) throw Object.assign(Error('missing'), { code: 'resource_missing' }); return copy(value) },
  checkout: async id => { const value = sessions.get(id); if (!value) throw Error('missing session'); return copy(value) },
  async createCheckout(body, key) {
    creates++; order.push('create')
    const result = memo(key, body, () => {
      const id = `cs_${randomUUID().replaceAll('-', '')}`, value = { id, object: 'checkout.session', mode: 'subscription', livemode: false, status: 'open', customer: body.customer ?? null, subscription: null, metadata: body.metadata,
        line_items: { data: [{ price: { id: (body.line_items as Row[])[0].price }, quantity: 1 }], has_more: false }, url: `https://checkout.stripe.com/c/pay/${id}` }
      sessions.set(id, value); return value
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    if (mode === 'create-uncertain') throw Error('response uncertain')
    return result
  },
  async updateSubscription(id, body, key) {
    updates++; order.push('update')
    if (mode === 'decline') throw { type: 'StripeCardError', message: 'Card declined' }
    const result = memo(key, body, () => {
      const value = subscriptions.get(id); if (!value) throw Error('missing subscription')
      const item = (body.items as Row[])[0], updated = { ...value, metadata: body.metadata, items: { data: [{ id: item.id, price: { id: item.price } }], has_more: false } }
      subscriptions.set(id, updated); return updated
    })
    if (mode === 'update-uncertain') throw Error('response uncertain')
    return result
  },
  async expireCheckout(id, key) {
    expires++; order.push('expire')
    const value = sessions.get(id); if (!value) throw Error('missing session')
    if (mode === 'complete-during-expire') { complete(id); throw Error('already complete') }
    return memo(key, {}, () => { value.status = 'expired'; value.url = null; return value })
  },
  portal: async customer => ({ id: 'bps_fixture', customer, url: 'https://billing.stripe.com/p/session/fixture' }),
}
const deps: SubscriptionDependencies = { database: { run }, gateway, baseUrl: 'https://fixture.invalid', clock: () => clock }
const change = (input: Parameters<typeof changeNativeSubscription>[1], actor = owner, dependencies = deps) => changeNativeSubscription(actor, input, dependencies)
async function row() { return (await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0] }
function complete(id: string) {
  const session = sessions.get(id)!, subId = `sub_${id}`, customer = session.customer ?? 'cus_generated'
  session.status = 'complete'; session.url = null; session.customer = customer; session.subscription = subId
  const price = (((session.line_items as Row).data as Row[])[0].price as Row).id as string
  subscriptions.set(subId, { ...subscription(subId, price), customer, metadata: session.metadata })
}
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.app_subscription_billing_requests,public.stripe_connections,public.tenant_settings,public.tenant_subscriptions,public.plans,public.profiles,public.app_accounts,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text NOT NULL,plan text);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),role text,must_change_password boolean);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,name text,slug text,description text,monthly_price numeric,annual_price numeric,transaction_fee_pct numeric,features jsonb,is_active boolean,sort_order int,stripe_price_monthly_id text,stripe_price_annual_id text);
    CREATE TABLE public.tenant_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),billing_cycle text NOT NULL,status text NOT NULL,override_monthly_price numeric,override_annual_price numeric,override_transaction_fee_pct numeric,override_notes text,stripe_customer_id text,stripe_subscription_id text,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean NOT NULL DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),currency text,orders_enabled boolean,direct_orders_enabled boolean,table_management_enabled boolean,whatsapp_orders_enabled boolean,whatsapp text,tips_enabled boolean,item_notes_enabled boolean,ingredient_customization_enabled boolean,dine_in_enabled boolean,pickup_enabled boolean,delivery_enabled boolean,upsell_enabled boolean,delivery_fee_cents int);
    CREATE TABLE public.stripe_connections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES public.tenants(id),stripe_account_id text,scope text,is_active boolean,connected_at timestamptz,disconnected_at timestamptz,created_at timestamptz,updated_at timestamptz)`)
  const proposal = await readFile(new URL('../../docs/proposals/native-subscription-billing-owned-only.sql', import.meta.url), 'utf8')
  await admin.query(proposal.slice(proposal.indexOf('CREATE TABLE public.app_subscription_billing_requests'), proposal.indexOf('REVOKE ALL ON')))
  await admin.query("INSERT INTO public.tenants VALUES($1,'tenant-a','first'),($2,'tenant-b','first')", [a, b])
  await admin.query("INSERT INTO public.profiles VALUES($1,$4,'store-admin',false),($2,$4,'store-staff',false),($3,NULL,'superadmin',false)", [ownerId, staffId, superId, a])
  await admin.query('INSERT INTO public.app_accounts VALUES($1,NULL),($2,NULL),($3,NULL)', [ownerId, staffId, superId])
  await admin.query("INSERT INTO public.plans VALUES($1,'First','first',NULL,20,200,3,$3,true,10,'price_first_month','price_first_year'),($2,'Second','second',NULL,30,300,4,$4,true,20,'price_second_month','price_second_year')", [first, second, JSON.stringify(['orders']), JSON.stringify(['payments','stripe-connect'])])
  await admin.query("INSERT INTO public.tenant_settings(tenant_id,currency,delivery_fee_cents,dine_in_enabled,pickup_enabled) VALUES($1,'brl',250,true,true),($2,'usd',500,true,true)", [a, b])
})
beforeEach(async () => {
  sessions.clear(); subscriptions.clear(); responses.clear(); creates = updates = expires = 0; mode = ''; order = []
  await admin.query('DELETE FROM public.app_subscription_billing_requests; DELETE FROM public.tenant_subscriptions; UPDATE public.app_accounts SET disabled_at=NULL; UPDATE public.profiles SET must_change_password=false')
  await admin.query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status,stripe_customer_id,override_monthly_price,override_transaction_fee_pct) VALUES($1,$3,'monthly','cancelled','cus_a',0,0),($2,$3,'monthly','active','cus_b',NULL,NULL)", [a, b, first])
  await admin.query('UPDATE public.plans SET is_active=true')
})
after(async () => { await pool.end(); try { await admin.query('DROP TABLE IF EXISTS public.app_subscription_billing_requests,public.stripe_connections,public.tenant_settings,public.tenant_subscriptions,public.plans,public.profiles,public.app_accounts,public.tenants CASCADE') } finally { await admin.end() } })
test('staff read-only subscription/page DTOs and superadmin defaults preserve prices/zero overrides and tenant scope', async () => {
  const staff: SubscriptionActor = { ...owner, actorId: staffId, role: 'store-staff' }
  const page = await run(false, query => readSubscriptionPage(query, staff)); assert.equal(page.plans.length, 2); assert.equal(page.plan?.monthly_price, 0)
  assert.equal((await run(false, query => readSubscriptionApi(query, staff))).subscription?.billing_cycle, 'monthly')
  await assert.rejects(change({ mode: 'checkout', planId: second, cycle: 'monthly' }, staff), { status: 403 }); assert.equal(creates, 0)
  await admin.query('DELETE FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])
  assert.equal((await run(false, query => readSuperSubscription(query, superActor))).id, null)
})
test('concurrent checkout requests create one real session and a same-plan retry reuses its URL', async () => {
  const input = { mode: 'checkout' as const, planId: first, cycle: 'monthly' as const }
  const results = await Promise.allSettled([change(input), change(input)])
  assert.equal(sessions.size, 1); assert.equal(creates, 1); assert.ok(results.some(value => value.status === 'fulfilled' && value.value.body.url))
  const again = await change(input); assert.equal(again.body.url, [...sessions.values()][0].url); assert.equal(creates, 1)
  assert.equal((await row()).status, 'cancelled')
})
test('a different plan expires the old open checkout before creating its replacement', async () => {
  await change({ mode: 'checkout', planId: first, cycle: 'monthly' })
  const before = [...sessions.keys()][0]
  await change({ mode: 'checkout', planId: second, cycle: 'annual' })
  assert.equal(sessions.get(before)?.status, 'expired'); assert.deepEqual(order, ['create','expire','create']); assert.equal(expires, 1)
})
test('completed checkout is remembered before webhook delivery so refresh cannot create a parallel subscription', async () => {
  await change({ mode: 'checkout', planId: first, cycle: 'monthly' }); complete([...sessions.keys()][0])
  const same = await change({ mode: 'checkout', planId: first, cycle: 'monthly' }); assert.equal(same.body.updated, true); assert.equal(same.body.changed, false)
  const changed = await change({ mode: 'checkout', planId: second, cycle: 'annual' }); assert.equal(changed.body.updated, true); assert.equal(updates, 1); assert.equal(creates, 1)
  assert.equal((await row()).stripe_subscription_id, null)
})
test('completion racing retirement is recognized without a second checkout or blind expiry retry', async () => {
  await change({ mode: 'checkout', planId: first, cycle: 'monthly' }); mode = 'complete-during-expire'
  await assert.rejects(change({ mode: 'checkout', planId: second, cycle: 'monthly' }), { status: 409 })
  mode = ''; await change({ mode: 'checkout', planId: second, cycle: 'monthly' })
  assert.equal(creates, 1); assert.equal(updates, 1); assert.equal(expires, 1)
})
test('live subscription swaps preserve proration/error behavior; dunning is rejected even for the same price', async () => {
  subscriptions.set('sub_live', subscription('sub_live'))
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='sub_live',status='active' WHERE tenant_id=$1", [a])
  await change({ mode: 'checkout', planId: second, cycle: 'annual' }); assert.equal(creates, 0); assert.equal(updates, 1)
  const saved = (await admin.query("SELECT request_body FROM public.app_subscription_billing_requests WHERE operation='plan_change'")).rows[0].request_body
  assert.equal(saved.proration_behavior, 'create_prorations'); assert.equal(saved.payment_behavior, 'error_if_incomplete'); assert.equal(saved.proration_date, Math.floor(clock.getTime() / 1000))
  const value = subscriptions.get('sub_live')!; value.status = 'past_due'
  await assert.rejects(change({ mode: 'checkout', planId: second, cycle: 'annual' }), { status: 409 }); assert.equal(updates, 1)
})
test('uncertain create/update outcomes remain durable and block fresh financial effects', async () => {
  mode = 'create-uncertain'; await assert.rejects(change({ mode: 'checkout', planId: first, cycle: 'monthly' }))
  mode = ''; await assert.rejects(change({ mode: 'checkout', planId: first, cycle: 'monthly' })); assert.equal(creates, 1)
  assert.equal((await admin.query('SELECT state FROM public.app_subscription_billing_requests')).rows[0].state, 'reconcile_required')
  await admin.query('DELETE FROM public.app_subscription_billing_requests'); sessions.clear(); subscriptions.set('sub_live', subscription('sub_live'))
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='sub_live' WHERE tenant_id=$1", [a])
  mode = 'update-uncertain'; await assert.rejects(change({ mode: 'cycle', cycle: 'annual' })); mode = ''
  await assert.rejects(change({ mode: 'cycle', cycle: 'annual' })); assert.equal(updates, 1)
})
test('superadmin local overrides preserve zero/null and reconcile atomically while owner cannot assign a free plan', async () => {
  const result = await change({ mode: 'admin', patch: { plan_id: second, status: 'active', override_monthly_price: 0, override_notes: null } }, superActor)
  assert.equal(result.body.plan_id, second); assert.equal(Number((await row()).override_monthly_price), 0); assert.equal(result.sync?.reason, 'plan_changed')
  await assert.rejects(change({ mode: 'admin', patch: { plan_id: first } }, owner), { status: 403 })
  assert.equal(creates + updates, 0)
})
test('local cycle preference and portal preserve actual customer/URL without changing another tenant', async () => {
  const noProvider = { ...deps, gateway: { ...gateway, context: async () => { throw Error('Stripe is not configured') } } }
  assert.equal((await change({ mode: 'cycle', cycle: 'annual' }, owner, noProvider)).body.success, true); assert.equal((await row()).billing_cycle, 'annual')
  assert.deepEqual(await nativeSubscriptionPortal(owner, deps), { url: 'https://billing.stripe.com/p/session/fixture' })
  assert.equal((await admin.query('SELECT billing_cycle FROM public.tenant_subscriptions WHERE tenant_id=$1', [b])).rows[0].billing_cycle, 'monthly')
})
test('a missing subscription row is prepared as cancelled before checkout, never as a paid entitlement', async () => {
  await admin.query('DELETE FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])
  await change({ mode: 'checkout', planId: first, cycle: 'monthly' })
  assert.equal((await row()).status, 'cancelled'); assert.equal((await row()).plan_id, first); assert.equal(creates, 1)
})
test('current disabled/reset/tenant controls and stale pricing refuse before financial writes', async () => {
  await admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1', [ownerId])
  await assert.rejects(change({ mode: 'checkout', planId: first, cycle: 'monthly' }), { status: 403 }); assert.equal(creates, 0)
  await admin.query('UPDATE public.app_accounts SET disabled_at=NULL WHERE id=$1', [ownerId])
  await assert.rejects(change({ mode: 'checkout', planId: first, cycle: 'monthly' }, { ...owner, tenantId: b }), { status: 403 })
  assert.equal((await run(false, query => subscriptionSnapshot(query, owner))).tenantId, a)
})
test('a price reconfigured during provider read cannot be charged from a stale SQL snapshot', async () => {
  subscriptions.set('sub_live', subscription('sub_live'))
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='sub_live',status='active' WHERE tenant_id=$1", [a])
  const stale = { ...deps, gateway: { ...gateway, subscription: async (id: string) => {
    const value = await gateway.subscription(id)
    await admin.query("UPDATE public.plans SET stripe_price_annual_id='price_reconfigured' WHERE id=$1", [second]); return value
  } } }
  try { await assert.rejects(change({ mode: 'checkout', planId: second, cycle: 'annual' }, owner, stale), { status: 503 }); assert.equal(updates, 0) }
  finally { await admin.query("UPDATE public.plans SET stripe_price_annual_id='price_second_year' WHERE id=$1", [second]) }
})
test('an expired durable attempt refuses before another provider update even when the price already changed', async () => {
  subscriptions.set('sub_live', subscription('sub_live'))
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='sub_live',status='active' WHERE tenant_id=$1", [a])
  await change({ mode: 'cycle', cycle: 'annual' })
  await admin.query("UPDATE public.app_subscription_billing_requests SET state='requesting',first_attempt_at=$1,attempt_token=$2,lease_until=$1", [new Date(clock.getTime() - 20 * 60 * 60 * 1000).toISOString(), randomUUID()])
  await assert.rejects(change({ mode: 'cycle', cycle: 'annual' })); assert.equal(updates, 1)
  assert.equal((await admin.query('SELECT state FROM public.app_subscription_billing_requests')).rows[0].state, 'reconcile_required')
})
test('a local mark failure after a prorated effect rolls back plan/overrides and leaves explicit uncertainty', async () => {
  subscriptions.set('sub_live', subscription('sub_live'))
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='sub_live',status='active' WHERE tenant_id=$1", [a])
  await admin.query('ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT fixture_refuse_override CHECK(override_monthly_price<>7)')
  try { await assert.rejects(change({ mode: 'admin', patch: { plan_id: second, override_monthly_price: 7 } }, superActor)) }
  finally { await admin.query('ALTER TABLE public.tenant_subscriptions DROP CONSTRAINT fixture_refuse_override') }
  assert.equal(updates, 1); assert.equal((await row()).plan_id, first); assert.equal(Number((await row()).override_monthly_price), 0)
  assert.equal((await admin.query('SELECT state FROM public.app_subscription_billing_requests')).rows[0].state, 'reconcile_required')
  await assert.rejects(change({ mode: 'admin', patch: { plan_id: second, override_monthly_price: 7 } }, superActor)); assert.equal(updates, 1)
})
test('revoked local authority after a provider effect cannot finalize business data or repeat the effect', async () => {
  subscriptions.set('sub_live', subscription('sub_live'))
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='sub_live',status='active' WHERE tenant_id=$1", [a])
  const revoked = { ...deps, gateway: { ...gateway, updateSubscription: async (id: string, body: Row, key: string) => {
    const result = await gateway.updateSubscription(id, body, key)
    await admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1', [ownerId]); return result
  } } }
  await assert.rejects(change({ mode: 'cycle', cycle: 'annual' }, owner, revoked), { status: 403 })
  assert.equal((await row()).billing_cycle, 'monthly'); assert.equal(updates, 1)
  assert.equal((await admin.query('SELECT state FROM public.app_subscription_billing_requests')).rows[0].state, 'reconcile_required')
})
