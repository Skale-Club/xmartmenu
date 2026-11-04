// Explicit loopback disposable target only. No production/Source/Auth calls.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPublicWaiterCall } from '../../src/lib/data/public-waiter-calls'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable waiter calls target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable waiter calls target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tenant = randomUUID(), foreign = randomUUID(), plan = randomUUID(), table = randomUUID(), foreignTable = randomUUID(), inactiveTable = randomUUID()
const run = (tableId = table, reason: unknown = 'waiter', date = new Date(), slug = 'restaurant') => adminMenuTransaction(pool, true, query => createPublicWaiterCall(query, slug, tableId, reason, date))
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.waiter_calls,public.restaurant_tables,public.tenant_subscriptions,public.plans,public.tenant_settings,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text UNIQUE,is_active boolean);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,features jsonb);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),status text);
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),orders_enabled boolean,direct_orders_enabled boolean,table_management_enabled boolean);
    CREATE TABLE public.restaurant_tables(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),name text,is_active boolean);
    CREATE TABLE public.waiter_calls(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),table_id uuid REFERENCES public.restaurant_tables(id),table_name text NOT NULL,reason text NOT NULL CHECK(reason IN('waiter','bill')),status text NOT NULL DEFAULT 'open' CHECK(status IN('open','acknowledged','done')),created_at timestamptz NOT NULL DEFAULT now(),last_called_at timestamptz NOT NULL DEFAULT now(),acknowledged_at timestamptz,acknowledged_by uuid,done_at timestamptz)`)
  await admin.query("INSERT INTO public.tenants VALUES($1,'restaurant',true),($2,'foreign',true)", [tenant, foreign])
  await admin.query('INSERT INTO public.plans VALUES($1,$2)', [plan, JSON.stringify(['orders'])])
  await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,$2,'active')", [tenant, plan])
  await admin.query('INSERT INTO public.tenant_settings VALUES($1,true,false,true)', [tenant])
  await admin.query("INSERT INTO public.restaurant_tables VALUES($1,$2,'Table 1',true),($3,$4,'Foreign',true),($5,$2,'Inactive',false)", [table, tenant, foreignTable, foreign, inactiveTable])
})
after(async () => { await pool.end(); await admin.end() })
test('concurrent first taps create one call and repeat the same ID', async () => {
  const results = await Promise.all([run(), run()])
  assert.deepEqual(results.map(row => row.status).sort(), [200, 201]); assert.equal(results[0].body.id, results[1].body.id)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.waiter_calls')).rows[0].n, 1)
})
test('repeated tap clears acknowledgment without replacing creation/table snapshot', async () => {
  const first = await run(), uid = randomUUID()
  await admin.query("UPDATE public.waiter_calls SET status='acknowledged',acknowledged_at=now(),acknowledged_by=$2 WHERE id=$1", [first.body.id, uid])
  const before = (await admin.query('SELECT * FROM public.waiter_calls WHERE id=$1', [first.body.id])).rows[0], date = new Date()
  const result = await run(table, 'waiter', date)
  const after = (await admin.query('SELECT * FROM public.waiter_calls WHERE id=$1', [first.body.id])).rows[0]
  assert.equal(result.body.id, first.body.id); assert.equal(after.status, 'open'); assert.equal(after.acknowledged_by, null); assert.equal(after.acknowledged_at, null)
  assert.deepEqual(after.created_at, before.created_at); assert.equal(after.table_name, before.table_name); assert.deepEqual(after.last_called_at, date)
})
test('done/stale calls and different reasons remain distinct', async () => {
  await admin.query("UPDATE public.waiter_calls SET status='done' WHERE tenant_id=$1", [tenant])
  const fresh = await run(); assert.equal(fresh.status, 201)
  await admin.query("UPDATE public.waiter_calls SET created_at=now()-interval '3 hours' WHERE id=$1", [fresh.body.id])
  const next = await run(), bill = await run(table, 'bill')
  assert.equal(next.status, 201); assert.notEqual(next.body.id, fresh.body.id); assert.equal(bill.status, 201); assert.notEqual(bill.body.id, next.body.id)
})
test('foreign/inactive tables and inactive tenants cannot create calls', async () => {
  const count = (await admin.query('SELECT count(*)::int AS n FROM public.waiter_calls')).rows[0].n
  for (const id of [foreignTable, inactiveTable, randomUUID()]) await assert.rejects(run(id), { status: 400 })
  await admin.query('UPDATE public.tenants SET is_active=false WHERE id=$1', [tenant])
  try { await assert.rejects(run(), { status: 404 }) } finally { await admin.query('UPDATE public.tenants SET is_active=true WHERE id=$1', [tenant]) }
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.waiter_calls')).rows[0].n, count)
})
test('current plan status/features and restaurant switches control admission', async () => {
  try {
    await admin.query("UPDATE public.tenant_subscriptions SET status='cancelled'"); await assert.rejects(run(), { status: 403 })
    await admin.query("UPDATE public.tenant_subscriptions SET status='trial'"); assert.equal((await run()).status, 200)
    await admin.query('UPDATE public.plans SET features=$1', [JSON.stringify(['menu'])]); await assert.rejects(run(), { status: 403 })
    await admin.query('UPDATE public.plans SET features=$1', [JSON.stringify(['payments'])])
    await admin.query('UPDATE public.tenant_settings SET table_management_enabled=false,direct_orders_enabled=true'); assert.equal((await run()).status, 200)
    await admin.query('UPDATE public.tenant_settings SET orders_enabled=false'); await assert.rejects(run(), { status: 403 })
  } finally {
    await admin.query("UPDATE public.tenant_subscriptions SET status='active'"); await admin.query('UPDATE public.plans SET features=$1', [JSON.stringify(['orders'])]); await admin.query('UPDATE public.tenant_settings SET orders_enabled=true,table_management_enabled=true,direct_orders_enabled=false')
  }
})
test('failed reopen rolls back acknowledgment and does not report a repeated success', async () => {
  const first = await run()
  await admin.query("UPDATE public.waiter_calls SET status='acknowledged',acknowledged_at=now(),acknowledged_by=$2 WHERE id=$1", [first.body.id, randomUUID()])
  const before = (await admin.query('SELECT * FROM public.waiter_calls WHERE id=$1', [first.body.id])).rows[0]
  await admin.query("ALTER TABLE public.waiter_calls ADD CONSTRAINT fixture_refuse_reopen CHECK(status<>'open') NOT VALID")
  try { await assert.rejects(run(), { status: 503 }) } finally { await admin.query('ALTER TABLE public.waiter_calls DROP CONSTRAINT fixture_refuse_reopen') }
  assert.deepEqual((await admin.query('SELECT * FROM public.waiter_calls WHERE id=$1', [first.body.id])).rows[0], before)
})
