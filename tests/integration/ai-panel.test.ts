// Explicit disposable loopback CI database only. No provider/Auth/Stripe calls.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { decryptApiKey, encryptApiKey } from '../../src/lib/crypto'
import { readAiBillingAvailability, readAiPanelTenants, readAiUnbilledCharge, readAiUsageSummary, writeAiPlatformSettings, writeAiTenantSettings } from '../../src/lib/data/ai-panel'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable AI panel target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable AI panel target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), actor = randomUUID(), superadmin = randomUUID(), initial = randomUUID(), platformInitial = randomUUID(), previousKey = process.env.CHAT_ADDON_ENCRYPTION_KEY
const owner = { actorId: actor, tenantId: a, role: 'store-admin' as const }, global = { actorId: superadmin, role: 'superadmin' as const }
const run = <T>(write: boolean, operation: (query: Parameters<typeof readAiUsageSummary>[0]) => Promise<T>) => adminMenuTransaction(pool, write, operation)
before(async () => {
  process.env.CHAT_ADDON_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  await admin.query(`DROP TABLE IF EXISTS public.ai_usage_events,public.tenant_ai_settings,public.platform_ai_settings,public.tenant_subscriptions,public.profiles,public.app_accounts,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,name text,slug text);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES public.app_accounts(id),role text,tenant_id uuid REFERENCES public.tenants(id),must_change_password boolean);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),stripe_customer_id text);
    CREATE TABLE public.platform_ai_settings(id smallint PRIMARY KEY CHECK(id=1),openrouter_api_key text,default_billing_mode text DEFAULT 'platform',default_markup_pct numeric(6,2) DEFAULT 30,usd_to_brl numeric(10,4) DEFAULT 5.5,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.tenant_ai_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),billing_mode text,openrouter_api_key text,markup_pct numeric(6,2),last_key_error text,last_key_error_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.ai_usage_events(id bigserial PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),occurred_at timestamptz,key_source text,billable boolean,cost_usd numeric(14,8),charge_usd numeric(14,8),invoiced_at timestamptz)`)
  await admin.query("INSERT INTO public.tenants VALUES($1,'A','a'),($2,'B','b')", [a, b])
  await admin.query('INSERT INTO public.app_accounts VALUES($1,NULL),($2,NULL)', [actor, superadmin])
  await admin.query("INSERT INTO public.profiles VALUES($1,'store-admin',$3,false),($2,'superadmin',NULL,false)", [actor, superadmin, a])
  await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,'fixture-customer'),($2,NULL)", [a, b])
  await admin.query("INSERT INTO public.platform_ai_settings(id,openrouter_api_key) VALUES(1,$1)", [encryptApiKey(platformInitial)])
  await admin.query("INSERT INTO public.tenant_ai_settings(tenant_id,billing_mode,openrouter_api_key,markup_pct,last_key_error,last_key_error_at) VALUES($1,'own_key',$3,25,'previous warning',now()),($2,'included',NULL,NULL,NULL,NULL)", [a, b, encryptApiKey(initial)])
  await admin.query("INSERT INTO public.ai_usage_events(tenant_id,occurred_at,key_source,billable,cost_usd,charge_usd,invoiced_at) VALUES($1,'2026-11-02','platform',true,0.1,0.13,NULL),($1,'2026-11-02','tenant',false,0.2,0.26,NULL),($1,'2026-11-02','platform',true,0.05,0.065,'2026-11-03'),($2,'2026-11-02','platform',true,0.9,1.17,NULL),(NULL,'2026-11-02','platform',false,0.4,0,NULL),($1,'2026-10-31','platform',true,0.01,0.013,NULL)", [a, b])
})
after(async () => {
  await pool.end()
  try { await admin.query('DROP TABLE IF EXISTS public.ai_usage_events,public.tenant_ai_settings,public.platform_ai_settings,public.tenant_subscriptions,public.profiles,public.app_accounts,public.tenants CASCADE') }
  finally { await admin.end(); if (previousKey === undefined) delete process.env.CHAT_ADDON_ENCRYPTION_KEY; else process.env.CHAT_ADDON_ENCRYPTION_KEY = previousKey }
})
test('numeric aggregates preserve scope/date/invoice/key-source buckets and include all-time unbilled usage', async () => {
  const all = await run(false, query => readAiUsageSummary(query, '2026-11-01'))
  assert.deepEqual(all.get(a), { calls: 3, costUsd: 0.35, chargeUsd: 0.455, unbilledChargeUsd: 0.13, byKey: { tenant: 1, platform: 2 } })
  assert.equal(all.get(null)?.calls, 1); assert.equal(all.get(b)?.chargeUsd, 1.17)
  const scoped = await run(false, query => readAiUsageSummary(query, '2026-11-01', a)); assert.deepEqual([...scoped.keys()], [a])
  assert.equal(await run(false, query => readAiUnbilledCharge(query, a)), 0.143)
})
test('owner changes encrypt only their key and preserve administrative margin; masked keys keep ciphertext and warnings', async () => {
  const next = randomUUID(); await run(true, query => writeAiTenantSettings(query, owner, { openrouter_api_key: next, tenant_id: b, markup_pct: 999, billing_mode: 'included' }, true))
  let row = (await admin.query('SELECT * FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0]
  assert.notEqual(row.openrouter_api_key, next); assert.equal(decryptApiKey(row.openrouter_api_key), next); assert.equal(row.billing_mode, 'own_key'); assert.equal(Number(row.markup_pct), 25); assert.equal(row.last_key_error, null)
  await admin.query("UPDATE public.tenant_ai_settings SET last_key_error='keep warning' WHERE tenant_id=$1", [a])
  const before = (await admin.query('SELECT * FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0]
  await run(true, query => writeAiTenantSettings(query, owner, { openrouter_api_key: 'aaaa••••bbbb' }, true))
  row = (await admin.query('SELECT * FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0]; assert.deepEqual(row, before)
  assert.equal((await admin.query('SELECT openrouter_api_key FROM public.tenant_ai_settings WHERE tenant_id=$1', [b])).rows[0].openrouter_api_key, null)
})
test('superadmin mode/margin changes preserve omitted keys and key removal preserves the chosen mode', async () => {
  const before = (await admin.query('SELECT openrouter_api_key FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0].openrouter_api_key
  await run(true, query => writeAiTenantSettings(query, { ...global, tenantId: a }, { billing_mode: 'included', markup_pct: 12.5 }, false))
  let row = (await admin.query('SELECT * FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0]; assert.equal(row.openrouter_api_key, before); assert.equal(row.billing_mode, 'included'); assert.equal(Number(row.markup_pct), 12.5)
  await run(true, query => writeAiTenantSettings(query, { ...global, tenantId: a }, { openrouter_api_key: null }, false))
  row = (await admin.query('SELECT * FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0]; assert.equal(row.openrouter_api_key, null); assert.equal(row.billing_mode, 'included'); assert.equal(row.last_key_error, null)
})
test('global singleton updates require current superadmin authority without an invented tenant and preserve masked keys', async () => {
  const next = randomUUID(); await run(true, query => writeAiPlatformSettings(query, global, { openrouter_api_key: next, default_billing_mode: 'included', default_markup_pct: 15, usd_to_brl: 5.75, id: 2 }))
  let row = (await admin.query('SELECT * FROM public.platform_ai_settings')).rows[0]; assert.equal(row.id, 1); assert.equal(decryptApiKey(row.openrouter_api_key), next); assert.equal(Number(row.usd_to_brl), 5.75)
  const cipher = row.openrouter_api_key
  await run(true, query => writeAiPlatformSettings(query, global, { openrouter_api_key: 'aaaa••••bbbb', default_billing_mode: 'platform' }))
  row = (await admin.query('SELECT * FROM public.platform_ai_settings')).rows[0]; assert.equal(row.openrouter_api_key, cipher); assert.equal(row.default_billing_mode, 'platform')
  await assert.rejects(run(true, query => writeAiPlatformSettings(query, owner, {})), { status: 403 })
})
test('overview exposes only key presence and billing availability exposes only a boolean', async () => {
  const tenants = await run(false, query => readAiPanelTenants(query, global))
  assert.equal(tenants.length, 2); assert.equal(tenants.some(row => 'openrouter_api_key' in row), false); assert.equal(typeof tenants[0].has_key, 'boolean')
  assert.equal(await run(false, query => readAiBillingAvailability(query, owner)), true)
  assert.equal(await run(false, query => readAiBillingAvailability(query, { ...global, tenantId: b })), false)
})
test('current roles/account controls/tenant scope and invalid margins refuse before mutation', async () => {
  await assert.rejects(run(true, query => writeAiTenantSettings(query, { ...owner, tenantId: b }, { openrouter_api_key: randomUUID() }, true)), { status: 403 })
  await assert.rejects(run(true, query => writeAiTenantSettings(query, { ...global, tenantId: a }, { markup_pct: -1 }, false)), { status: 400 })
  await admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1', [superadmin])
  try { await assert.rejects(run(true, query => writeAiPlatformSettings(query, global, {})), { status: 403 }) } finally { await admin.query('UPDATE public.app_accounts SET disabled_at=NULL WHERE id=$1', [superadmin]) }
})
test('constraint failure rolls back key/mode/margin fields together', async () => {
  const before = (await admin.query('SELECT * FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0]
  await admin.query('ALTER TABLE public.tenant_ai_settings ADD CONSTRAINT fixture_refuse_margin CHECK(markup_pct<=100) NOT VALID')
  try { await assert.rejects(run(true, query => writeAiTenantSettings(query, { ...global, tenantId: a }, { openrouter_api_key: randomUUID(), billing_mode: 'own_key', markup_pct: 500 }, false)), { status: 503 }) }
  finally { await admin.query('ALTER TABLE public.tenant_ai_settings DROP CONSTRAINT fixture_refuse_margin') }
  assert.deepEqual((await admin.query('SELECT * FROM public.tenant_ai_settings WHERE tenant_id=$1', [a])).rows[0], before)
})
