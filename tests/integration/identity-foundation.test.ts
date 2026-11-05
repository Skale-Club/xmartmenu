// Synthetic disposable CI service only. Never load .env or run on a live host.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { buildFoundationSql, foundationTransaction } from '../../scripts/ops/prepare-xmartmenu-identity-foundation.mjs'
import { assertManifest, MANIFEST_SQL, SOURCE_PROJECT, TABLES } from '../../scripts/ops/xmartmenu-source-protocol.mjs'
import {PILOT_SNAPSHOT_SQL,assertPilotSnapshot,comparePilotSnapshots} from '../../scripts/ops/xmartmenu-identity-pilot-snapshot.mjs'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const selected = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(selected.hostname) || selected.pathname !== '/xmartmenu_identity_test' || selected.search || selected.hash) throw Error('Disposable CI target required')
const control = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
const target = new URL(selected); target.pathname = '/xmartmenu'
const db = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
const ids = Array.from({ length: 7 }, () => randomUUID()), tenants = Array.from({ length: 3 }, () => randomUUID())
const orderIds = [randomUUID(), randomUUID()], product = randomUUID()
const createdRoles: string[] = []
let created = false

before(async () => {
  await control.connect()
  assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n, 0)
  assert.equal((await control.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='anon'")).rows[0].n, 0, 'Run foundation first on the fresh disposable CI service')
  for (const [name, options] of [
    ['xmail_owner', 'SUPERUSER NOLOGIN'], ['xmartmenu_owner', 'NOSUPERUSER NOLOGIN'],
    ['xmartmenu_runtime', 'NOSUPERUSER NOLOGIN BYPASSRLS CONNECTION LIMIT 12'],
    ['xmartmenu_staging_reader', 'NOSUPERUSER NOLOGIN BYPASSRLS CONNECTION LIMIT 2'],
    ['authenticated', 'NOSUPERUSER NOLOGIN'], ['service_role', 'NOSUPERUSER NOLOGIN'],
  ]) {
    const exists = (await control.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=$1', [name])).rows[0].n
    if (exists) {
      if (name.startsWith('xmartmenu_') || name === 'xmail_owner') throw Error('Owned disposable fixture role already exists')
    } else { await control.query(`CREATE ROLE ${name} ${options}`); createdRoles.push(name) }
  }
  await control.query('CREATE DATABASE xmartmenu OWNER xmartmenu_owner'); created = true
  await db.connect()
  await db.query('SET SESSION AUTHORIZATION xmail_owner')
  await db.query("SET timezone='UTC'; SET datestyle='ISO, YMD'; SET extra_float_digits=3; SET bytea_output='hex'")
  await db.query('GRANT USAGE ON SCHEMA public TO xmartmenu_runtime,xmartmenu_staging_reader')
  await db.query('SET ROLE xmartmenu_owner')
  const columns: Record<string, string> = {
    ai_usage_events: 'id bigserial PRIMARY KEY, marker text', audit_events: 'id bigserial PRIMARY KEY, marker text',
    profiles: 'id uuid PRIMARY KEY, tenant_id uuid, role text, must_change_password boolean DEFAULT false',
    products: 'id uuid PRIMARY KEY, tenant_id uuid, menu_id uuid, marker text',
    orders: 'id uuid PRIMARY KEY, tenant_id uuid, customer_id uuid, currency text, status text, total numeric(10,2)',
    order_items: 'id uuid PRIMARY KEY, order_id uuid, product_id uuid',
  }
  for (const name of TABLES) await db.query(`CREATE TABLE public.${name}(${columns[name] ?? 'id uuid PRIMARY KEY, marker text'})`)
  await db.query('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[], created_by text, idempotency_key text, rollback text[])')
  for (const [index, id] of ids.entries()) {
    await db.query('INSERT INTO auth.users VALUES($1)', [id])
    await db.query('INSERT INTO public.profiles(id,tenant_id,role) VALUES($1,$2,$3)', [id, index < 3 ? tenants[index] : null, index < 3 ? 'store-admin' : index < 6 ? 'customer' : 'superadmin'])
  }
  for (const id of tenants) await db.query('INSERT INTO public.tenants VALUES($1,$2)', [id, 'synthetic'])
  for (let index = 0; index < 56; index++) await db.query('INSERT INTO public.products VALUES($1,$2,NULL,$3)', [index ? randomUUID() : product, tenants[index % 3], 'synthetic'])
  for (const [index, id] of orderIds.entries()) await db.query('INSERT INTO public.orders VALUES($1,$2,NULL,NULL,$3,$4)', [id, tenants[index], index ? 'pending' : 'cancelled', index ? '77.90' : '247.90'])
  for (let index = 0; index < 6; index++) await db.query('INSERT INTO public.order_items VALUES($1,$2,$3)', [randomUUID(), orderIds[index % 2], product])
  for (let index = 0; index < 92; index++) await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)', [index === 91 ? '20261027097000' : `20260000${String(index).padStart(6, '0')}`, 'synthetic', ['SELECT 1']])
  await db.query("CREATE FUNCTION public.synthetic_helper() RETURNS integer LANGUAGE sql AS 'SELECT 1'")
  // Match LIVE: existing-table grants only, with no table default ACLs.
  await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA public TO xmartmenu_staging_reader')
  await db.query('RESET ROLE')
})

after(async () => {
  await db.end().catch(() => {})
  if (created) await control.query('DROP DATABASE xmartmenu')
  for (const name of createdRoles.reverse()) await control.query(`DROP ROLE ${name}`)
  await control.end()
})

const manifest = async () => assertManifest((await db.query(MANIFEST_SQL)).rows[0].manifest)
const fresh = (state: ReturnType<typeof assertManifest>) => ({ version: 1, sourceProject: SOURCE_PROJECT,
  capturedAt: new Date(Math.floor(Date.now()/1000)*1000).toISOString(), profilesDigest: state.digests.profiles,
  authorityDigest: state.criticalDigests.profile_authority, authIdsDigest: state.criticalDigests.auth_ids,
  users: ids.map((id, index) => ({ id, disabled: index === 0 })), readOnlySnapshot: true })

test('private body without its public open transaction refuses before any DDL', async () => {
  const state = await manifest(), parts = await foundationTransaction(state)
  await assert.rejects(db.query(parts.privateSql), /Public identity prelude transaction required/)
  await db.query('ROLLBACK')
  assert.deepEqual(await manifest(), state)
})

test('wrong candidate baseline fails atomically without creating tables or ledger rows', async () => {
  const state = await manifest(), changed = structuredClone(state); changed.digests.products = 'a'.repeat(64)
  await assert.rejects(db.query(await buildFoundationSql(changed)), /Candidate business baseline changed/)
  await db.query('ROLLBACK')
  assert.deepEqual(await manifest(), state)
})

test('new-table privilege failure rolls back all migrations and bootstrap', async () => {
  const state = await manifest()
  // This fixture-only role is uncommitted and rolls back with the injected
  // failure. The real operator never creates any cluster role.
  await db.query('BEGIN; CREATE ROLE anon NOSUPERUSER NOLOGIN; GRANT CREATE ON SCHEMA public TO anon')
  const sql = (await buildFoundationSql(state, fresh(state))).replace('CREATE TEMP TABLE identity_after', 'GRANT SELECT ON public.app_accounts TO anon;\nCREATE TEMP TABLE identity_after')
  await assert.rejects(db.query(sql), /Identity foundation proof refused/)
  await db.query('ROLLBACK')
  assert.deepEqual(await manifest(), state)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='anon'")).rows[0].n, 0)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename='app_accounts'")).rows[0].n, 0)
})

test('fresh seven exact accounts commit without anon and preserve UUIDs, controls and roles', async () => {
  const state = await manifest(), review = fresh(state)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_default_acl WHERE defaclrole='xmartmenu_owner'::regrole AND defaclobjtype='r'")).rows[0].n, 0)
  const parts = await foundationTransaction(state, review)
  await db.query(parts.publicPrelude)
  await db.query(parts.privateSql)
  const accounts = (await db.query('SELECT id,disabled_at IS NOT NULL disabled,session_version FROM public.app_accounts ORDER BY id')).rows
  assert.deepEqual(accounts, review.users.map(row => ({ ...row, session_version: 0 })).sort((a, b) => a.id.localeCompare(b.id)))
  assert.equal((await db.query('SELECT count(*)::int n FROM supabase_migrations.schema_migrations')).rows[0].n, 95)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.app_identity_bindings')).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.app_sessions')).rows[0].n, 0)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_authid WHERE rolname IN ('xmartmenu_runtime','xmartmenu_staging_reader') AND NOT rolcanlogin AND rolpassword IS NULL")).rows[0].n, 2)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='anon'")).rows[0].n, 0)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_default_acl WHERE defaclrole='xmartmenu_owner'::regrole AND defaclobjtype='r'")).rows[0].n, 0)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename IN ('app_accounts','app_identity_bindings','app_sessions','app_identity_challenges') AND has_table_privilege('xmartmenu_runtime',('public.'||tablename)::regclass,'SELECT') AND has_table_privilege('xmartmenu_runtime',('public.'||tablename)::regclass,'INSERT') AND has_table_privilege('xmartmenu_runtime',('public.'||tablename)::regclass,'UPDATE') AND has_table_privilege('xmartmenu_runtime',('public.'||tablename)::regclass,'DELETE') AND has_table_privilege('xmartmenu_staging_reader',('public.'||tablename)::regclass,'SELECT')")).rows[0].n, 4)
})

test('retry refuses existing foundation instead of replaying migrations or enabling accounts', async () => {
  // The old baseline is enough to compile; preflight must refuse before DDL.
  const { preservedManifestSql } = await import('../../scripts/ops/prepare-xmartmenu-identity-foundation.mjs')
  const state = assertManifest((await db.query(preservedManifestSql())).rows[0].manifest)
  await assert.rejects(db.query(await buildFoundationSql(state)), /Identity foundation preflight refused/)
  await db.query('ROLLBACK')
  assert.equal((await db.query('SELECT count(*)::int n FROM public.app_accounts')).rows[0].n, 7)
})

test('the private pilot export query preserves all47 business proofs and all four identity tables in a READ ONLY snapshot',async()=>{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try{
    const snapshot=assertPilotSnapshot((await db.query(PILOT_SNAPSHOT_SQL)).rows[0].pilot_snapshot)
    const proof=comparePilotSnapshots(snapshot,structuredClone(snapshot))
    assert.equal(proof.publicTablesMatched,51);assert.equal(proof.businessRowDigestsMatched,47);assert.equal(proof.ledgerRowsMatched,95)
    const changed=structuredClone(snapshot);changed.business.digests.menu_events='a'.repeat(64)
    assert.throws(()=>comparePilotSnapshots(snapshot,changed),/Pilot clone mismatch/)
    const controls=structuredClone(snapshot);controls.identity.app_accounts.digest='b'.repeat(64)
    assert.throws(()=>comparePilotSnapshots(snapshot,controls),/Pilot clone mismatch/)
    assert.equal((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on')
  }finally{await db.query('ROLLBACK')}
})
