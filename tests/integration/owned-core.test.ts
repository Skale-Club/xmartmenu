// Projection fixtures only, disposable loopback CI database; no dotenv/live SQL.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { OwnedPrincipalRepository } from '../../src/lib/auth/owned-principal'
import { OwnedShellRepository, PLATFORM_ACTIVITY_SQL } from '../../src/lib/auth/owned-shell'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated owned core target')
const pool = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const query = <R extends object>(sql: string, values?: unknown[]) => pool.query<R>(sql, values)
const profiles = new OwnedPrincipalRepository(query), shell = new OwnedShellRepository(query)
const a = randomUUID(), b = randomUUID(), inactive = randomUUID(), user = randomUUID(), disabled = randomUUID(), customer = randomUUID()
const from = '2026-11-01T00:00:00Z', to = '2026-11-05T00:00:00Z'
before(async () => {
  await pool.query(`DROP TABLE IF EXISTS public.tenants,public.profiles,public.app_accounts,public.tenant_settings,public.menu_sessions,public.orders,public.waiter_calls,public.products,public.categories,public.scan_events CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,name text,slug text,plan text,is_active boolean,created_at timestamptz DEFAULT now());
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,tenant_id uuid,full_name text,must_change_password boolean);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY,currency text,logo_url text);
    CREATE TABLE public.menu_sessions(tenant_id uuid,is_test boolean,started_at timestamptz,last_seen_at timestamptz);
    CREATE TABLE public.orders(tenant_id uuid,created_at timestamptz,status text,total numeric(12,2));
    CREATE TABLE public.waiter_calls(tenant_id uuid,created_at timestamptz);
    CREATE TABLE public.products(tenant_id uuid); CREATE TABLE public.categories(tenant_id uuid);
    CREATE TABLE public.scan_events(tenant_id uuid,scanned_at timestamptz);`)
  await pool.query(`INSERT INTO public.tenants(id,name,slug,plan,is_active) VALUES($1,'A','a','menu',true),($2,'B','b','menu',true),($3,'Hidden','hidden','menu',false)`, [a,b,inactive])
  await pool.query('INSERT INTO public.app_accounts VALUES($1,NULL),($2,now()),($3,NULL)', [user,disabled,customer])
  await pool.query(`INSERT INTO public.profiles VALUES($1,'store-admin',$4,'Fixture',false),($2,'superadmin',NULL,'Disabled',false),($3,'customer',$5,'Customer',false)`, [user,disabled,customer,a,b])
  await pool.query("INSERT INTO public.tenant_settings VALUES($1,'BRL',NULL)", [a])
  await pool.query(`INSERT INTO public.menu_sessions VALUES($1,false,'2026-11-02','2026-11-02T00:02:00Z'),($1,false,'2026-11-02','2026-11-03'),($1,true,'2026-11-02','2026-11-02T00:01:00Z'),($2,false,'2026-11-02','2026-11-02T00:00:30Z'),($3,false,'2026-11-02','2026-11-02T00:00:30Z')`, [a,b,inactive])
  await pool.query(`INSERT INTO public.orders VALUES($1,'2026-11-02','paid',12.35),($1,'2026-11-02','cancelled',90),($1,'2026-11-02','payment_failed',91),($1,'2026-11-02','awaiting_payment',92),($2,'2026-11-02','paid',5),($1,'2026-11-05','paid',99)`, [a,b])
  await pool.query("INSERT INTO public.waiter_calls VALUES($1,'2026-11-02')", [a])
  const source = await readFile(new URL('../../supabase/migrations/20261026130000_menu_engagement.sql', import.meta.url), 'utf8')
  const rpc = source.match(/CREATE OR REPLACE FUNCTION public\.get_platform_menu_overview\([\s\S]*?\$\$;/)?.[0]
  assert.ok(rpc); await pool.query(rpc)
})
after(async () => { await pool.end() })

test('native profile joins exact immutable UID and refuses disabled accounts', async () => {
  const actor = await profiles.profile(user, new Date())
  assert.equal(actor?.tenantId, a); assert.equal(actor?.tenant?.id, a)
  assert.equal(actor?.role, 'store-admin')
  assert.equal(await profiles.profile(disabled, new Date()), null)
  assert.equal(await profiles.profile(randomUUID(), new Date()), null)
})

test('native preview and dashboard deny cross-tenant/customer access before data reads', async () => {
  const actor = (await profiles.profile(user, new Date()))!
  assert.equal(await profiles.previewTenant(actor, b), null)
  await assert.rejects(shell.dashboard(actor,b), /Forbidden/)
  const client = (await profiles.profile(customer, new Date()))!
  await assert.rejects(shell.dashboard(client,b), /Forbidden/)
  await pool.query('INSERT INTO public.products VALUES($1),($2),($2)', [a,b])
  await pool.query('INSERT INTO public.categories VALUES($1),($2)', [a,b])
  await pool.query("INSERT INTO public.scan_events VALUES($1,'2026-11-04T04:00Z'),($2,'2026-11-04T04:00Z'),($1,'2026-11-04T02:00Z')", [a,b])
  assert.deepEqual(await shell.dashboard(actor,a,new Date('2026-11-04T12:00Z')), { products: 1,categories: 1,scans: 1 })
})

test('native activity is identical to the unmodified source RPC for money, windows, status exclusions and median clamp', async () => {
  const native = (await pool.query(PLATFORM_ACTIVITY_SQL,[from,to])).rows[0].activity
  const source = (await pool.query('SELECT public.get_platform_menu_overview($1,$2) AS activity',[from,to])).rows[0].activity
  assert.deepEqual(native,source); assert.equal(native.length,2)
  assert.equal(native[0].tenant_id,a); assert.equal(native[0].revenue,12.35); assert.equal(native[0].orders,1)
  assert.equal(native[0].sessions,2); assert.equal(native[0].median_seconds,5460); assert.equal(native[0].currency,'BRL')
  assert.equal(native[1].currency,'USD')
})

test('revocation and recovery controls are observed on the next native profile read', async () => {
  await pool.query('UPDATE public.profiles SET must_change_password=true WHERE id=$1',[user])
  const actor = (await profiles.profile(user,new Date()))!
  assert.equal(actor.mustChangePassword,true); await assert.rejects(shell.dashboard(actor,a),/Forbidden/)
  await pool.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1',[user])
  assert.equal(await profiles.profile(user,new Date()),null)
})
