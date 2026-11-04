// Explicit disposable CI target only; no dotenv, app or provider calls.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { recordPublicScan } from '../../src/lib/data/public-scans'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable scans target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable scans target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const active = randomUUID(), inactive = randomUUID()
const run = (id: unknown) => adminMenuTransaction(pool, true, query => recordPublicScan(query, id))
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.scan_events,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,is_active boolean);
    CREATE TABLE public.scan_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),qr_code_id uuid,scanned_at timestamptz DEFAULT now(),user_agent text,country text)`)
  await admin.query('INSERT INTO public.tenants VALUES($1,true),($2,false)', [active, inactive])
})
after(async () => { await pool.end(); await admin.end() })
test('concurrent accepted visits remain distinct events with native timestamps and no client metadata', async () => {
  assert.deepEqual(await Promise.all([run(active), run(active)]), [{ ok: true }, { ok: true }])
  const rows = (await admin.query('SELECT * FROM public.scan_events WHERE tenant_id=$1', [active])).rows
  assert.equal(rows.length, 2); assert.notEqual(rows[0].id, rows[1].id)
  for (const row of rows) { assert.ok(row.scanned_at instanceof Date); assert.equal(row.qr_code_id, null); assert.equal(row.user_agent, null); assert.equal(row.country, null) }
})
test('inactive, absent and malformed tenant IDs cannot append events', async () => {
  const before = (await admin.query('SELECT count(*)::int AS n FROM public.scan_events')).rows[0].n
  for (const id of [inactive, randomUUID(), 'not-a-uuid']) await assert.rejects(run(id), { status: 404 })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.scan_events')).rows[0].n, before)
})
test('database rejection rolls back and fails instead of acknowledging a lost scan', async () => {
  const before = (await admin.query('SELECT count(*)::int AS n FROM public.scan_events')).rows[0].n
  await admin.query('ALTER TABLE public.scan_events ADD CONSTRAINT fixture_refuse_scan CHECK(false) NOT VALID')
  try { await assert.rejects(run(active), { status: 503 }) }
  finally { await admin.query('ALTER TABLE public.scan_events DROP CONSTRAINT fixture_refuse_scan') }
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.scan_events')).rows[0].n, before)
})
