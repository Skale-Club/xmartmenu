// Explicit disposable loopback CI database only. No providers/Auth/Source calls.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readNativeTenantCapabilities, readNativeTenantPlan, reconcileNativeSettings, reconcileNativeTenantPlan } from '../../src/lib/data/tenant-plan'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable tenant plan target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable tenant plan target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), plan = randomUUID()
const run = <T>(write: boolean, operation: (query: Parameters<typeof readNativeTenantPlan>[0]) => Promise<T>) => adminMenuTransaction(pool, write, operation)
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.tenant_settings,public.tenant_subscriptions,public.plans,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,name text,slug text,description text,monthly_price numeric,annual_price numeric,transaction_fee_pct numeric,features jsonb);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),billing_cycle text,status text,override_monthly_price numeric,override_annual_price numeric,override_transaction_fee_pct numeric,override_notes text);
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),orders_enabled boolean,direct_orders_enabled boolean,table_management_enabled boolean,whatsapp_orders_enabled boolean,whatsapp text,tips_enabled boolean,item_notes_enabled boolean,ingredient_customization_enabled boolean,dine_in_enabled boolean,pickup_enabled boolean,delivery_enabled boolean,upsell_enabled boolean,delivery_fee_cents int,pickup_eta_minutes int)`)
  await admin.query('INSERT INTO public.tenants VALUES($1),($2)', [a, b]); await admin.query("INSERT INTO public.plans VALUES($1,'Payments','payments',NULL,25.50,250,3.50,$2)", [plan, JSON.stringify(['payments', 'stripe-connect'])])
  await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,$3,'monthly','active',0,NULL,0,'grandfathered account'),($2,$3,'annual','past_due',NULL,NULL,NULL,NULL)", [a, b, plan])
  await admin.query("INSERT INTO public.tenant_settings VALUES($1,true,true,true,true,'12025550101',true,true,true,true,true,true,true,250,20),($2,true,true,true,true,'12025550102',true,true,true,true,true,true,true,500,40)", [a, b])
})
after(async () => { await pool.end(); try { await admin.query('DROP TABLE IF EXISTS public.tenant_settings,public.tenant_subscriptions,public.plans,public.tenants CASCADE') } finally { await admin.end() } })
test('native plan DTO retains numeric zeros/null defaults, exact scope, live features and grandfathering', async () => {
  assert.deepEqual(await run(false, query => readNativeTenantPlan(query, a)), { id: plan, name: 'Payments', slug: 'payments', description: null, monthly_price: 0, annual_price: 250, transaction_fee_pct: 0, features: ['payments', 'stripe-connect'], billing_cycle: 'monthly', status: 'active', is_grandfathered: true })
  assert.deepEqual(await run(false, query => readNativeTenantPlan(query, b)), { id: plan, name: 'Payments', slug: 'payments', description: null, monthly_price: 25.5, annual_price: 250, transaction_fee_pct: 3.5, features: [], billing_cycle: 'annual', status: 'past_due', is_grandfathered: false })
  assert.equal(await run(false, query => readNativeTenantPlan(query, randomUUID())), null)
})
test('capabilities combine current live plan and own settings while respecting explicit supplied null/settings', async () => {
  const active = await run(false, query => readNativeTenantCapabilities(query, a)), revoked = await run(false, query => readNativeTenantCapabilities(query, b))
  assert.equal(active.guestOrdering, true); assert.equal(active.waiterOrdering, true); assert.equal(active.delivery, true); assert.equal(active.plan.stripe, true)
  assert.equal(revoked.guestOrdering, false); assert.equal(revoked.waiterOrdering, false)
  assert.equal((await run(false, query => readNativeTenantCapabilities(query, a, null))).guestOrdering, false)
  assert.equal((await run(false, query => readNativeTenantCapabilities(query, a, { orders_enabled: true, direct_orders_enabled: true }))).guestOrdering, true)
})
test('current revoked plan reconciliation switches off only forbidden flags and preserves fees, modes and other tenants', async () => {
  const beforeA = (await admin.query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1', [a])).rows[0]
  const result = await run(true, query => reconcileNativeTenantPlan(query, b)); assert.equal(result.ok, true)
  const bRow = (await admin.query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1', [b])).rows[0]
  assert.equal(bRow.direct_orders_enabled, false); assert.equal(bRow.table_management_enabled, false); assert.equal(bRow.delivery_enabled, false); assert.equal(bRow.upsell_enabled, false)
  assert.equal(bRow.orders_enabled, true); assert.equal(bRow.whatsapp_orders_enabled, true); assert.equal(bRow.dine_in_enabled, true); assert.equal(bRow.pickup_enabled, true); assert.equal(bRow.delivery_fee_cents, 500); assert.equal(bRow.pickup_eta_minutes, 40)
  assert.deepEqual((await admin.query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1', [a])).rows[0], beforeA)
})
test('explicit orders ceiling keeps staff features, removes guest features and does not create missing settings', async () => {
  await run(true, query => reconcileNativeSettings(query, a, ['orders']))
  const row = (await admin.query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1', [a])).rows[0]
  assert.equal(row.table_management_enabled, true); assert.equal(row.item_notes_enabled, true); assert.equal(row.ingredient_customization_enabled, true); assert.equal(row.direct_orders_enabled, false)
  const count = (await admin.query('SELECT count(*)::int AS n FROM public.tenant_settings')).rows[0].n
  assert.equal((await run(true, query => reconcileNativeTenantPlan(query, randomUUID()))).ok, true)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.tenant_settings')).rows[0].n, count)
})
test('constraint failure rolls back all downgrade flags instead of leaving a partial reconciliation', async () => {
  const before = (await admin.query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1', [a])).rows[0]
  await admin.query('ALTER TABLE public.tenant_settings ADD CONSTRAINT fixture_keep_table CHECK(table_management_enabled=true) NOT VALID')
  try { await assert.rejects(run(true, query => reconcileNativeSettings(query, a, [])), { status: 503 }) } finally { await admin.query('ALTER TABLE public.tenant_settings DROP CONSTRAINT fixture_keep_table') }
  assert.deepEqual((await admin.query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1', [a])).rows[0], before)
})
