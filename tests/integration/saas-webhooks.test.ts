// Explicit disposable loopback CI target only. No Stripe/QStash/Source/Auth calls.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applySaasWebhook, type SaasWebhookEvent } from '../../src/lib/data/saas-webhooks'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable SaaS webhook target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable SaaS webhook target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), firstPlan = randomUUID(), secondPlan = randomUUID(), connection = randomUUID(), otherConnection = randomUUID()
const subId = 'subscription-a-fixture', accountId = 'account-a-fixture', now = new Date()
const event = (type: string, object: unknown): SaasWebhookEvent => ({ id: `evt_${randomUUID().replaceAll('-', '')}`, type, data: { object } })
const run = (input: SaasWebhookEvent) => adminMenuTransaction(pool, true, query => applySaasWebhook(query, input, now))
const subscription = async () => (await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0]
const settings = async () => (await admin.query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1', [a])).rows[0]
const metadata = { tenant_id: a, kind: 'plan' }
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.processed_stripe_events,public.ai_usage_events,public.stripe_connections,public.chat_addon_settings,public.tenant_settings,public.tenant_subscriptions,public.plans,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,name text,slug text,description text,monthly_price numeric,annual_price numeric,transaction_fee_pct numeric,features jsonb,sort_order int,stripe_price_monthly_id text,stripe_price_annual_id text);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),billing_cycle text,status text,override_monthly_price numeric,override_annual_price numeric,override_transaction_fee_pct numeric,override_notes text,stripe_customer_id text,stripe_subscription_id text,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean,chat_addon_active boolean,chat_addon_since timestamptz);
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),orders_enabled boolean,direct_orders_enabled boolean,table_management_enabled boolean,whatsapp_orders_enabled boolean,whatsapp text,tips_enabled boolean,item_notes_enabled boolean,ingredient_customization_enabled boolean,dine_in_enabled boolean,pickup_enabled boolean,delivery_enabled boolean,upsell_enabled boolean,delivery_fee_cents int,pickup_eta_minutes int);
    CREATE TABLE public.chat_addon_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),enabled boolean);
    CREATE TABLE public.stripe_connections(id uuid PRIMARY KEY,tenant_id uuid UNIQUE REFERENCES public.tenants(id),stripe_account_id text,is_active boolean);
    CREATE TABLE public.processed_stripe_events(event_id text PRIMARY KEY,event_type text,processed_at timestamptz);
    CREATE TABLE public.ai_usage_events(tenant_id uuid REFERENCES public.tenants(id),billable boolean,invoiced_at timestamptz,occurred_at timestamptz,billing_batch uuid)`)
  await admin.query('INSERT INTO public.tenants VALUES($1),($2)', [a, b])
  await admin.query("INSERT INTO public.plans VALUES($1,'Orders','orders',NULL,20,200,3,$3,10,'price-orders-month','price-orders-year'),($2,'Payments','payments',NULL,30,300,4,$4,20,'price-payments-month','price-payments-year')", [firstPlan, secondPlan, JSON.stringify(['orders']), JSON.stringify(['payments', 'stripe-connect'])])
  await admin.query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$3,'monthly','active'),($2,$3,'monthly','active')", [a, b, firstPlan])
  await admin.query('INSERT INTO public.tenant_settings(tenant_id,delivery_fee_cents,pickup_eta_minutes,whatsapp) VALUES($1,250,20,\'12025550101\'),($2,500,40,\'12025550102\')', [a, b])
  await admin.query('INSERT INTO public.chat_addon_settings VALUES($1,true),($2,true)', [a, b])
  await admin.query("INSERT INTO public.stripe_connections VALUES($1,$2,$3,true),($4,$5,'account-b-fixture',true)", [connection, a, accountId, otherConnection, b])
})
beforeEach(async () => {
  await admin.query('DELETE FROM public.processed_stripe_events')
  await admin.query('DELETE FROM public.ai_usage_events')
  await admin.query("UPDATE public.tenant_subscriptions SET plan_id=$1,billing_cycle='monthly',status='active',override_monthly_price=0,override_annual_price=NULL,override_transaction_fee_pct=0,override_notes='preserved',stripe_customer_id='customer-fixture',stripe_subscription_id=CASE WHEN tenant_id=$2 THEN $3 ELSE 'subscription-b-fixture' END,current_period_start=NULL,current_period_end=NULL,cancel_at_period_end=false,chat_addon_active=true,chat_addon_since=NULL", [firstPlan, a, subId])
  await admin.query('UPDATE public.tenant_settings SET orders_enabled=true,direct_orders_enabled=true,table_management_enabled=true,whatsapp_orders_enabled=true,tips_enabled=true,item_notes_enabled=true,ingredient_customization_enabled=true,dine_in_enabled=true,pickup_enabled=true,delivery_enabled=true,upsell_enabled=true')
  await admin.query('UPDATE public.chat_addon_settings SET enabled=true'); await admin.query('UPDATE public.stripe_connections SET is_active=true')
})
after(async () => { await pool.end(); try { await admin.query('DROP TABLE IF EXISTS public.processed_stripe_events,public.ai_usage_events,public.stripe_connections,public.chat_addon_settings,public.tenant_settings,public.tenant_subscriptions,public.plans,public.tenants CASCADE') } finally { await admin.end() } })
test('concurrent redelivery atomically activates one plan, creates one ledger row and one CRM intent', async () => {
  const input = event('checkout.session.completed', { metadata: { ...metadata, plan_id: secondPlan }, customer: 'new-customer-fixture', subscription: 'new-subscription-fixture' })
  const results = await Promise.all([run(input), run(input)])
  assert.equal(results.filter(row => row.skipped).length, 1); assert.equal(results.filter(row => row.pendingSync?.reason === 'plan_activated').length, 1)
  const row = await subscription(); assert.equal(row.plan_id, secondPlan); assert.equal(row.stripe_customer_id, 'new-customer-fixture'); assert.equal(row.stripe_subscription_id, 'new-subscription-fixture'); assert.equal(row.status, 'active'); assert.equal(Number(row.override_monthly_price), 0)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events')).rows[0].n, 1)
})
test('tenant serialization permits the admin FK key-share insert while a webhook waits on its subscription', async () => {
  await admin.query('DELETE FROM public.tenant_settings WHERE tenant_id=$1', [a])
  const writer = await admin.connect()
  let signal!: () => void
  const waiting = new Promise<void>(resolve => { signal = resolve })
  let outcome: Promise<{ error?: unknown }> | undefined
  try {
    await writer.query('BEGIN')
    await writer.query('SELECT tenant_id FROM public.tenant_subscriptions WHERE tenant_id=$1 FOR SHARE', [a])
    outcome = adminMenuTransaction(pool, true, query => applySaasWebhook(async (sql, values) => {
      const pending = query(sql, values)
      if (sql.startsWith('SELECT plan_id FROM public.tenant_subscriptions')) signal()
      return pending
    }, event('customer.subscription.deleted', { id: subId, metadata, status: 'canceled' }), now)).then(() => ({}), error => ({ error }))
    await Promise.race([waiting, outcome.then(() => { throw Error('Webhook finished before the subscription wait') })])
    await writer.query("INSERT INTO public.tenant_settings(tenant_id,delivery_fee_cents,pickup_eta_minutes,whatsapp) VALUES($1,250,20,'12025550101')", [a])
    await writer.query('COMMIT')
    const result = await outcome; assert.equal(result.error, undefined)
    assert.equal((await subscription()).status, 'cancelled'); assert.equal((await settings()).direct_orders_enabled, false)
  } finally {
    await writer.query('ROLLBACK').catch(() => {}); writer.release(); if (outcome) await outcome
  }
})
test('legacy null receipts skip, conflicting types refuse, and separate unknown events remain independent receipts', async () => {
  const input = event('unhandled.fixture', {})
  await admin.query('INSERT INTO public.processed_stripe_events VALUES($1,NULL,now())', [input.id]); assert.equal((await run(input)).skipped, true)
  await admin.query("UPDATE public.processed_stripe_events SET event_type='account.updated' WHERE event_id=$1", [input.id]); await assert.rejects(run(input), { status: 503 })
  await run(event('unhandled.fixture', {})); await run(event('unhandled.fixture', {}))
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events')).rows[0].n, 3)
})
test('subscription before checkout backfills ID, resolves item/legacy periods and annual/monthly upgrades/downgrades', async () => {
  await admin.query('UPDATE public.tenant_subscriptions SET stripe_subscription_id=NULL WHERE tenant_id=$1', [a])
  const up = await run(event('customer.subscription.updated', { id: subId, metadata, status: 'trialing', cancel_at_period_end: true, items: { data: [{ price: { id: 'price-payments-year' }, current_period_start: 1000, current_period_end: 2000 }] } }))
  assert.deepEqual(up.pendingSync, { tenantId: a, reason: 'plan_changed', tags: ['upgrade'] })
  let row = await subscription(); assert.equal(row.plan_id, secondPlan); assert.equal(row.billing_cycle, 'annual'); assert.equal(row.status, 'trial'); assert.equal(row.cancel_at_period_end, true); assert.equal(row.stripe_subscription_id, subId); assert.equal(row.current_period_end.toISOString(), new Date(2000000).toISOString())
  const down = await run(event('customer.subscription.updated', { id: subId, metadata, status: 'active', current_period_start: 3000, current_period_end: 4000, items: { data: [{ price: { id: 'price-orders-month' } }] } }))
  assert.deepEqual(down.pendingSync, { tenantId: a, reason: 'plan_changed', tags: ['downgrade'] })
  row = await subscription(); assert.equal(row.plan_id, firstPlan); assert.equal(row.billing_cycle, 'monthly'); assert.equal(row.current_period_end.toISOString(), new Date(4000000).toISOString())
  const flags = await settings(); assert.equal(flags.direct_orders_enabled, false); assert.equal(flags.table_management_enabled, true); assert.equal(flags.delivery_fee_cents, 250); assert.equal(flags.dine_in_enabled, true)
})
test('non-live/deleted plan events revoke paid flags and preserve unrelated tenant data and numeric overrides', async () => {
  for (const status of ['paused', 'unpaid', 'incomplete', 'past_due', 'incomplete_expired', 'canceled']) {
    await run(event('customer.subscription.updated', { id: subId, metadata, status }))
    assert.equal((await subscription()).status, ['incomplete_expired', 'canceled'].includes(status) ? 'cancelled' : 'past_due')
  }
  const deleted = await run(event('customer.subscription.deleted', { id: subId, metadata, status: 'canceled' }))
  assert.deepEqual(deleted.pendingSync, { tenantId: a, reason: 'churned' })
  const flags = await settings(); assert.equal(flags.direct_orders_enabled, false); assert.equal(flags.table_management_enabled, false); assert.equal(flags.dine_in_enabled, true); assert.equal(flags.pickup_enabled, true); assert.equal(flags.delivery_fee_cents, 250)
  assert.equal((await admin.query('SELECT status FROM public.tenant_subscriptions WHERE tenant_id=$1', [b])).rows[0].status, 'active')
})
test('chat activation and lifecycle keep pending-cancel access and disable paid/widget state together when no longer live', async () => {
  await admin.query('UPDATE public.tenant_subscriptions SET chat_addon_active=false WHERE tenant_id=$1', [a])
  await run(event('checkout.session.completed', { metadata: { tenant_id: a, addon: 'chat' }, customer: 'chat-customer-fixture' }))
  let row = await subscription(); assert.equal(row.chat_addon_active, true); assert.deepEqual(row.chat_addon_since, now); assert.equal(row.stripe_customer_id, 'chat-customer-fixture')
  await run(event('customer.subscription.updated', { id: 'chat-sub-fixture', metadata: { tenant_id: a, addon: 'chat' }, status: 'active', cancel_at_period_end: true }))
  assert.equal((await subscription()).chat_addon_active, true); assert.equal((await admin.query('SELECT enabled FROM public.chat_addon_settings WHERE tenant_id=$1', [a])).rows[0].enabled, true)
  await run(event('customer.subscription.deleted', { id: 'chat-sub-fixture', metadata: { tenant_id: a, addon: 'chat' }, status: 'canceled' }))
  row = await subscription(); assert.equal(row.chat_addon_active, false); assert.equal((await admin.query('SELECT enabled FROM public.chat_addon_settings WHERE tenant_id=$1', [a])).rows[0].enabled, false)
})
test('invoice dunning supports top/parent/line subscription shapes and reconciles the unique tenant only', async () => {
  for (const shape of [{ subscription: subId }, { parent: { subscription_details: { subscription: subId } } }, { lines: { data: [{ parent: { subscription_item_details: { subscription: subId } } }] } }]) {
    assert.deepEqual((await run(event('invoice.payment_failed', shape))).pendingSync, { tenantId: a, reason: 'past_due' })
  }
  assert.equal((await subscription()).status, 'past_due'); assert.equal((await settings()).table_management_enabled, false)
  assert.equal((await admin.query('SELECT status FROM public.tenant_subscriptions WHERE tenant_id=$1', [b])).rows[0].status, 'active')
})
test('Connect changes ignore payouts-only flaps, scope account IDs and return security intent only on actual disable', async () => {
  const unchanged = await run(event('account.updated', { id: accountId, charges_enabled: true, payouts_enabled: false }))
  assert.equal(unchanged.disabledAccountId, undefined); assert.equal((await admin.query('SELECT is_active FROM public.stripe_connections WHERE id=$1', [connection])).rows[0].is_active, true)
  const disabled = await run(event('account.updated', { id: accountId, charges_enabled: false, payouts_enabled: true }))
  assert.equal(disabled.disabledAccountId, accountId); assert.equal((await admin.query('SELECT is_active FROM public.stripe_connections WHERE id=$1', [connection])).rows[0].is_active, false)
  assert.equal((await admin.query('SELECT is_active FROM public.stripe_connections WHERE id=$1', [otherConnection])).rows[0].is_active, true)
})
test('ambiguous price/subscription/account mappings refuse without business mutation or a success receipt', async () => {
  const original = await subscription()
  await admin.query("UPDATE public.plans SET stripe_price_annual_id='price-orders-month' WHERE id=$1", [secondPlan])
  try { await assert.rejects(run(event('customer.subscription.updated', { id: subId, metadata, status: 'active', items: { data: [{ price: { id: 'price-orders-month' } }] } })), { status: 503 }) } finally { await admin.query("UPDATE public.plans SET stripe_price_annual_id='price-payments-year' WHERE id=$1", [secondPlan]) }
  await admin.query('UPDATE public.tenant_subscriptions SET stripe_subscription_id=$1 WHERE tenant_id=$2', [subId, b])
  try { await assert.rejects(run(event('invoice.payment_failed', { subscription: subId })), { status: 503 }) } finally { await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='subscription-b-fixture' WHERE tenant_id=$1", [b]) }
  await admin.query('UPDATE public.stripe_connections SET stripe_account_id=$1 WHERE id=$2', [accountId, otherConnection])
  try { await assert.rejects(run(event('account.updated', { id: accountId, charges_enabled: false })), { status: 503 }) } finally { await admin.query("UPDATE public.stripe_connections SET stripe_account_id='account-b-fixture' WHERE id=$1", [otherConnection]) }
  assert.deepEqual(await subscription(), original); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events')).rows[0].n, 0)
})
test('receipt or addon-widget failure rolls back all earlier metadata writes', async () => {
  const original = await subscription()
  await admin.query("ALTER TABLE public.processed_stripe_events ADD CONSTRAINT fixture_refuse_receipt CHECK(event_type<>'checkout.session.completed') NOT VALID")
  try { await assert.rejects(run(event('checkout.session.completed', { metadata: { ...metadata, plan_id: secondPlan } })), { status: 503 }) } finally { await admin.query('ALTER TABLE public.processed_stripe_events DROP CONSTRAINT fixture_refuse_receipt') }
  assert.deepEqual(await subscription(), original)
  await admin.query('ALTER TABLE public.chat_addon_settings ADD CONSTRAINT fixture_keep_widget CHECK(enabled=true) NOT VALID')
  try { await assert.rejects(run(event('customer.subscription.deleted', { metadata: { tenant_id: a, addon: 'chat' }, status: 'canceled' })), { status: 503 }) } finally { await admin.query('ALTER TABLE public.chat_addon_settings DROP CONSTRAINT fixture_keep_widget') }
  assert.deepEqual(await subscription(), original); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events')).rows[0].n, 0)
})
test('draft renewal requiring AI billing refuses before mutation/receipt; unrelated or unmatched invoices acknowledge safely', async () => {
  const original = await subscription()
  const invoice = { id: 'invoice-fixture', status: 'draft', billing_reason: 'subscription_cycle', currency: 'usd', parent: { subscription_details: { subscription: subId } } }
  await admin.query('INSERT INTO public.ai_usage_events VALUES($1,true,NULL,$2,NULL)', [a, now.toISOString()])
  const required = event('invoice.created', invoice); await assert.rejects(run(required), { status: 503 })
  assert.deepEqual(await subscription(), original); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events')).rows[0].n, 0)
  assert.deepEqual(await run(event('invoice.created', { ...invoice, status: 'paid' })), { received: true })
  assert.deepEqual(await run(event('invoice.created', { ...invoice, parent: { subscription_details: { subscription: 'unmatched-fixture' } } })), { received: true })
  await admin.query('DELETE FROM public.ai_usage_events')
  assert.deepEqual(await run(event('invoice.created', invoice)), { received: true })
  await admin.query('INSERT INTO public.ai_usage_events VALUES($1,true,NULL,$2,NULL)', [a, now.toISOString()])
  await admin.query('UPDATE public.tenant_subscriptions SET stripe_customer_id=NULL WHERE tenant_id=$1', [a])
  assert.deepEqual(await run(event('invoice.created', invoice)), { received: true })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events')).rows[0].n, 4)
})
