// Synthetic CI fixtures only. Never production rows, credentials or dumps.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { assertManifest, compareManifests, MANIFEST_SQL, TABLES } from '../../scripts/ops/xprout-source-protocol.mjs'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated rehearsal test target')
const owner = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const fixtureTarget = new URL(target); fixtureTarget.pathname = '/xmartmenu_rehearsal_manifest_test'
const client = new pg.Client({ connectionString: fixtureTarget.href, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const authIds = Array.from({ length: 7 }, () => randomUUID()), tenantIds = Array.from({ length: 3 }, () => randomUUID())
const orderIds = [randomUUID(), randomUUID()], product = randomUUID()
let created = false
before(async () => {
  await owner.connect()
  // Refuse if it already exists; never reset another test's database.
  await owner.query('CREATE DATABASE xmartmenu_rehearsal_manifest_test'); created = true
  await client.connect()
  await client.query("SET timezone='UTC'; SET datestyle='ISO, YMD'; SET extra_float_digits=3; SET bytea_output='hex'")
  const columns: Record<string, string> = {
    ai_usage_events: 'id bigserial PRIMARY KEY, marker text',
    audit_events: 'id bigserial PRIMARY KEY, marker text',
    profiles: 'id uuid PRIMARY KEY, tenant_id uuid, role text',
    products: 'id uuid PRIMARY KEY, tenant_id uuid, menu_id uuid, marker text',
    orders: 'id uuid PRIMARY KEY, tenant_id uuid, customer_id uuid, currency text, status text, total numeric(10,2)',
    order_items: 'id uuid PRIMARY KEY, order_id uuid, product_id uuid',
  }
  for (const table of TABLES) await client.query(`CREATE TABLE public.${table}(${columns[table] ?? 'id uuid PRIMARY KEY, marker text'})`)
  await client.query('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[])')
  for (const id of authIds) await client.query('INSERT INTO auth.users VALUES($1)', [id])
  for (const [index, id] of authIds.entries()) await client.query('INSERT INTO public.profiles VALUES($1,$2,$3)', [id, index < 3 ? tenantIds[index] : null, index < 3 ? 'store-admin' : index < 6 ? 'customer' : 'superadmin'])
  for (const id of tenantIds) await client.query('INSERT INTO public.tenants VALUES($1,$2)', [id, 'synthetic'])
  for (let index = 0; index < 56; index++) await client.query('INSERT INTO public.products VALUES($1,$2,$3,$4)', [index === 0 ? product : randomUUID(), tenantIds[index % 3], null, 'synthetic'])
  for (const [index, id] of orderIds.entries()) await client.query('INSERT INTO public.orders VALUES($1,$2,NULL,NULL,$3,$4)', [id, tenantIds[index], index === 0 ? 'cancelled' : 'pending', index === 0 ? '247.90' : '77.90'])
  for (let index = 0; index < 6; index++) await client.query('INSERT INTO public.order_items VALUES($1,$2,$3)', [randomUUID(), orderIds[index % 2], product])
  for (let index = 0; index < 92; index++) await client.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)', [index === 91 ? '20261027097000' : `20260000${String(index).padStart(6, '0')}`, 'synthetic', ['SELECT 1']])
  await client.query("INSERT INTO public.platform_ai_settings VALUES(gen_random_uuid(),'synthetic-private-fixture'); CREATE FUNCTION public.synthetic_helper() RETURNS integer LANGUAGE sql AS 'SELECT 1'")
  await client.query("SELECT pg_catalog.setval('public.audit_events_id_seq',34,true)")
})
after(async () => { await client.end().catch(() => {}); if (created) await owner.query('DROP DATABASE xmartmenu_rehearsal_manifest_test'); await owner.end() })
const manifest = async () => assertManifest((await client.query(MANIFEST_SQL)).rows[0].manifest)

test('canonical exported-snapshot manifest SQL runs on47 synthetic PostgreSQL tables and preserves NULL monetary context', async () => {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const source = await manifest(), report = compareManifests(source, await manifest())
    assert.equal(Object.keys(source.digests).length, 47)
    assert.equal(Object.keys(source.criticalDigests).length, 6)
    assert.equal(report.fullPublicRowDigestsMatched, 47)
    assert.equal(report.nullableOrderTotals, 'matched')
    assert.equal(report.loginMigrated, false)
    assert.equal(report.sequenceStatesMatched, 2)
    assert.equal(source.sequences.audit_events_id_seq.lastValue, '34')
    assert.equal(source.sequences.ai_usage_events_id_seq.isCalled, false)
  } finally { await client.query('ROLLBACK') }
})
test('full public row digest detects an opaque integration-value change despite unchanged row count', async () => {
  const source = await manifest()
  await client.query("UPDATE public.platform_ai_settings SET marker='changed-synthetic-private-fixture'")
  const changed = await manifest()
  assert.equal(source.counts.platform_ai_settings, changed.counts.platform_ai_settings)
  assert.notEqual(source.digests.platform_ai_settings, changed.digests.platform_ai_settings)
  assert.throws(() => compareManifests(source, changed))
  await client.query("UPDATE public.platform_ai_settings SET marker='synthetic-private-fixture'")
})
test('critical UUID/authority digest rejects tenant reassignment without email matching or role-count changes', async () => {
  const source = await manifest()
  await client.query('UPDATE public.profiles SET tenant_id=$1 WHERE id=$2', [tenantIds[1], authIds[0]])
  const changed = await manifest()
  assert.deepEqual(source.roles, changed.roles)
  assert.notEqual(source.criticalDigests.profile_authority, changed.criticalDigests.profile_authority)
  assert.throws(() => compareManifests(source, changed))
  await client.query('UPDATE public.profiles SET tenant_id=$1 WHERE id=$2', [tenantIds[0], authIds[0]])
})
test('ledger record/function-body changes and NULL-to-USD conversion all fail reconciliation', async () => {
  const source = await manifest()
  await client.query("UPDATE supabase_migrations.schema_migrations SET name='changed' WHERE version='20261027097000'")
  const ledgerChange = await manifest()
  assert.throws(() => compareManifests(source, ledgerChange))
  await client.query("UPDATE supabase_migrations.schema_migrations SET name='synthetic' WHERE version='20261027097000'")
  await client.query("CREATE OR REPLACE FUNCTION public.synthetic_helper() RETURNS integer LANGUAGE sql AS 'SELECT 2'")
  const functionChange = await manifest()
  assert.notEqual(source.functionDigest, functionChange.functionDigest)
  assert.throws(() => compareManifests(source, functionChange))
  await client.query("CREATE OR REPLACE FUNCTION public.synthetic_helper() RETURNS integer LANGUAGE sql AS 'SELECT 1'; UPDATE public.orders SET currency='USD'")
  await assert.rejects(manifest())
  await client.query('UPDATE public.orders SET currency=NULL')
})
test('reviewed sequence states retain ownership and setval restores both called and never-called states', async () => {
  const source = await manifest()
  await client.query("SELECT pg_catalog.setval('public.audit_events_id_seq',999,true); SELECT pg_catalog.setval('public.ai_usage_events_id_seq',777,true)")
  const changed = await manifest()
  assert.throws(() => compareManifests(source, changed))
  for (const [name, state] of Object.entries(source.sequences) as Array<[string, { lastValue: string; isCalled: boolean }]>) {
    await client.query('SELECT pg_catalog.setval($1::regclass,$2::bigint,$3::boolean)', [`public.${name}`, state.lastValue, state.isCalled])
  }
  assert.equal(compareManifests(source, await manifest()).sequenceStatesMatched, 2)
})
