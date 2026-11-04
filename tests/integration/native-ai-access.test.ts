// Disposable loopback target only. No key decryption or provider/Stripe calls.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readPlatformAiRecord, readTenantAiRecord, recordTenantAiKeyError, insertAiUsageRecord, type AiUsageRecord } from '../../src/lib/data/ai-access'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable AI access target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable AI access target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tenant = randomUUID(), foreign = randomUUID(), ciphertext = randomUUID()
const usage = (tenantId: string | null = tenant): AiUsageRecord => ({ tenant_id: tenantId, feature: 'chat', model: 'test/model', key_source: 'platform', billable: tenantId !== null, cost_usd: 0.01234567, markup_pct: 25, charge_usd: tenantId ? 0.01543209 : 0, generation_id: randomUUID(), request_id: 'test-request' })
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.ai_usage_events,public.tenant_ai_settings,public.platform_ai_settings,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.platform_ai_settings(id smallint PRIMARY KEY CHECK(id=1),openrouter_api_key text,default_billing_mode text,default_markup_pct numeric(6,2),usd_to_brl numeric(10,4));
    CREATE TABLE public.tenant_ai_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),billing_mode text,openrouter_api_key text,markup_pct numeric(6,2),last_key_error text,last_key_error_at timestamptz);
    CREATE TABLE public.ai_usage_events(id bigserial PRIMARY KEY,occurred_at timestamptz NOT NULL DEFAULT now(),tenant_id uuid REFERENCES public.tenants(id),feature text NOT NULL,model text,key_source text CHECK(key_source IN('platform','tenant')),billable boolean NOT NULL,cost_usd numeric(14,8) NOT NULL CHECK(cost_usd>=0),markup_pct numeric(6,2),charge_usd numeric(14,8) NOT NULL CHECK(charge_usd>=0),generation_id text,request_id text,invoiced_at timestamptz,stripe_invoice_item_id text,billing_batch uuid)`)
  await admin.query('INSERT INTO public.tenants VALUES($1),($2)', [tenant, foreign])
  await admin.query("INSERT INTO public.platform_ai_settings VALUES(1,$1,'platform',30,5.5)", [ciphertext])
  await admin.query("INSERT INTO public.tenant_ai_settings VALUES($1,'own_key',$3,20,NULL,NULL),($2,'included',NULL,NULL,NULL,NULL)", [tenant, foreign, ciphertext])
})
after(async () => { await pool.end(); await admin.end() })
test('fixed platform and exact tenant projections preserve ciphertext and defaults without cross-tenant leakage', async () => {
  const global = await adminMenuTransaction(pool, false, readPlatformAiRecord)
  assert.equal(global?.openrouter_api_key, ciphertext); assert.equal(Number(global?.default_markup_pct), 30)
  const local = await adminMenuTransaction(pool, false, query => readTenantAiRecord(query, tenant))
  const other = await adminMenuTransaction(pool, false, query => readTenantAiRecord(query, foreign))
  assert.equal(local?.openrouter_api_key, ciphertext); assert.equal(other?.openrouter_api_key, null); assert.equal(other?.billing_mode, 'included')
  assert.equal(await adminMenuTransaction(pool, false, query => readTenantAiRecord(query, randomUUID())), null)
})
test('key warning updates only the selected tenant and leaves encrypted key/mode/markup intact', async () => {
  const date = new Date().toISOString()
  await adminMenuTransaction(pool, true, query => recordTenantAiKeyError(query, tenant, 'HTTP 402: credit exhausted', date))
  const rows = (await admin.query('SELECT * FROM public.tenant_ai_settings ORDER BY tenant_id')).rows
  const local = rows.find(row => row.tenant_id === tenant), other = rows.find(row => row.tenant_id === foreign)
  assert.equal(local.last_key_error, 'HTTP 402: credit exhausted'); assert.equal(local.last_key_error_at.toISOString(), date); assert.equal(local.openrouter_api_key, ciphertext); assert.equal(local.billing_mode, 'own_key'); assert.equal(Number(local.markup_pct), 20); assert.equal(other.last_key_error, null)
})
test('usage preserves decimal charges and leaves all invoice/settlement fields untouched', async () => {
  const input = usage(); await adminMenuTransaction(pool, true, query => insertAiUsageRecord(query, input))
  const row = (await admin.query('SELECT * FROM public.ai_usage_events WHERE generation_id=$1', [input.generation_id])).rows[0]
  assert.equal(row.tenant_id, tenant); assert.equal(row.cost_usd, '0.01234567'); assert.equal(row.charge_usd, '0.01543209'); assert.equal(row.markup_pct, '25.00')
  assert.equal(row.invoiced_at, null); assert.equal(row.stripe_invoice_item_id, null); assert.equal(row.billing_batch, null); assert.ok(row.occurred_at instanceof Date)
})
test('platform-only usage keeps null tenant and zero billable charge', async () => {
  const input = usage(null); await adminMenuTransaction(pool, true, query => insertAiUsageRecord(query, input))
  const row = (await admin.query('SELECT tenant_id,billable,charge_usd FROM public.ai_usage_events WHERE generation_id=$1', [input.generation_id])).rows[0]
  assert.equal(row.tenant_id, null); assert.equal(row.billable, false); assert.equal(Number(row.charge_usd), 0)
})
test('constraint failures roll back warning and usage changes without mutation retries', async () => {
  const before = (await admin.query('SELECT last_key_error FROM public.tenant_ai_settings WHERE tenant_id=$1', [tenant])).rows[0]
  const input = { ...usage(), cost_usd: -1 }
  await assert.rejects(adminMenuTransaction(pool, true, async query => { await recordTenantAiKeyError(query, tenant, 'should roll back', new Date().toISOString()); await insertAiUsageRecord(query, input) }), { status: 503 })
  assert.deepEqual((await admin.query('SELECT last_key_error FROM public.tenant_ai_settings WHERE tenant_id=$1', [tenant])).rows[0], before)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.ai_usage_events WHERE generation_id=$1', [input.generation_id])).rows[0].n, 0)
})
