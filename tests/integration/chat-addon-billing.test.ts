// Explicit disposable loopback database only. No real Stripe/Auth/provider calls.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readChatAddonBilling, writeChatAddonOverride } from '../../src/lib/data/chat-addon-billing'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable addon billing target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable addon billing target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), actor = randomUUID(), superadmin = randomUUID(), plan = randomUUID(), customerId = randomUUID()
const owner = { actorId: actor, tenantId: a, role: 'store-admin' as const }, global = { actorId: superadmin, tenantId: a, role: 'superadmin' as const }
const run = <T>(write: boolean, operation: (query: Parameters<typeof readChatAddonBilling>[0]) => Promise<T>) => adminMenuTransaction(pool, write, operation)
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.chat_addon_settings,public.tenant_subscriptions,public.plans,public.profiles,public.app_accounts,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES public.app_accounts(id),role text,tenant_id uuid REFERENCES public.tenants(id),must_change_password boolean);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,chat_addon_available boolean);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),stripe_customer_id text,chat_addon_active boolean,chat_addon_override boolean,marker text);
    CREATE TABLE public.chat_addon_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),enabled boolean,rate_limit_per_phone_per_day int)`)
  await admin.query('INSERT INTO public.tenants VALUES($1),($2)', [a, b]); await admin.query('INSERT INTO public.app_accounts VALUES($1,NULL),($2,NULL)', [actor, superadmin])
  await admin.query("INSERT INTO public.profiles VALUES($1,'store-admin',$3,false),($2,'superadmin',NULL,false)", [actor, superadmin, a])
  await admin.query('INSERT INTO public.plans VALUES($1,true)', [plan]); await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,$3,$4,false,NULL,'preserved'),($2,$3,NULL,true,NULL,'foreign')", [a, b, plan, customerId])
  await admin.query('INSERT INTO public.chat_addon_settings VALUES($1,false,30),($2,true,30)', [a, b])
})
after(async () => {
  await pool.end()
  try { await admin.query('DROP TABLE IF EXISTS public.chat_addon_settings,public.tenant_subscriptions,public.plans,public.profiles,public.app_accounts,public.tenants CASCADE') }
  finally { await admin.end() }
})
test('checkout metadata preserves addon availability, active-state and exact tenant customer without mutating the subscription', async () => {
  const before = (await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0]
  const result = await run(false, query => readChatAddonBilling(query, owner, true))
  assert.equal(result.status?.available, true); assert.equal(result.status?.enabled, false); assert.equal(result.active, false); assert.equal(result.customerId, customerId)
  assert.deepEqual((await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0], before)
})
test('cancel metadata remains available when the plan/addon is unavailable so existing billing can still be stopped', async () => {
  await admin.query('UPDATE public.plans SET chat_addon_available=false')
  try {
    assert.equal((await run(false, query => readChatAddonBilling(query, owner, true))).status?.available, false)
    const cancel = await run(false, query => readChatAddonBilling(query, owner, false)); assert.equal(cancel.status, null); assert.equal(cancel.customerId, customerId)
  } finally { await admin.query('UPDATE public.plans SET chat_addon_available=true') }
})
test('current local role, tenant, reset and disabled controls reject before returning customer metadata or modifying an override', async () => {
  await assert.rejects(run(false, query => readChatAddonBilling(query, { ...owner, tenantId: b }, true)), { status: 403 })
  await assert.rejects(run(true, query => writeChatAddonOverride(query, owner, true)), { status: 403 })
  await admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1', [actor])
  try { await assert.rejects(run(false, query => readChatAddonBilling(query, owner, false)), { status: 403 }) } finally { await admin.query('UPDATE public.app_accounts SET disabled_at=NULL WHERE id=$1', [actor]) }
})
test('superadmin tri-state override changes only that field and keeps the existing update-only missing-row success contract', async () => {
  const before = (await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0]
  for (const override of [true, false, null]) {
    assert.deepEqual(await run(true, query => writeChatAddonOverride(query, global, override)), { ok: true })
    assert.deepEqual((await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0], { ...before, chat_addon_override: override })
  }
  await assert.rejects(run(true, query => writeChatAddonOverride(query, global, 'true')), { status: 400 })
  assert.deepEqual(await run(true, query => writeChatAddonOverride(query, { ...global, tenantId: randomUUID() }, true)), { ok: true })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.tenant_subscriptions')).rows[0].n, 2)
})
test('database rejection rolls back the override and preserves all subscription metadata', async () => {
  const before = (await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0]
  await admin.query('ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT fixture_refuse_override CHECK(chat_addon_override IS NOT TRUE) NOT VALID')
  try { await assert.rejects(run(true, query => writeChatAddonOverride(query, global, true)), { status: 503 }) }
  finally { await admin.query('ALTER TABLE public.tenant_subscriptions DROP CONSTRAINT fixture_refuse_override') }
  assert.deepEqual((await admin.query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1', [a])).rows[0], before)
})
