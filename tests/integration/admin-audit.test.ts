// Only the disposable, loopback CI database. No dotenv or live migrations.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readOwnerAuditPage, readPlatformAuditPage } from '../../src/lib/data/admin-audit'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated admin audit target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tenantA = randomUUID(), tenantB = randomUUID(), ownerId = randomUUID(), supportId = randomUUID(), otherId = randomUUID()

before(async () => {
  await admin.query('DROP TABLE IF EXISTS public.audit_events, public.profiles, public.tenants CASCADE')
  await admin.query('CREATE TABLE public.tenants(id uuid PRIMARY KEY,name text NOT NULL,slug text NOT NULL)')
  await admin.query('CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,role text NOT NULL,tenant_id uuid)')
  await admin.query(`CREATE TABLE public.audit_events(
    id bigserial PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), tenant_id uuid, actor_id uuid,
    via text NOT NULL, table_name text NOT NULL, record_id text,
    action text NOT NULL, changes jsonb NOT NULL DEFAULT '{}'::jsonb, request_id text)`)
  await admin.query('INSERT INTO public.tenants(id,name,slug) VALUES($1,\'Tenant A\',\'tenant-a\'),($2,\'Tenant B\',\'tenant-b\')', [tenantA, tenantB])
  await admin.query('INSERT INTO public.profiles(id,full_name,role,tenant_id) VALUES($1,\'A Owner\',\'store-admin\',$2),($3,\'Private Support Name\',\'superadmin\',NULL),($4,\'B Owner\',\'store-admin\',$5)', [ownerId, tenantA, supportId, otherId, tenantB])
  await admin.query(`INSERT INTO public.audit_events(id,occurred_at,tenant_id,actor_id,via,table_name,record_id,action,changes,request_id) VALUES
    (11,now(),$1,$2,'browser','products','p1','update','{"price":[10,12]}'::jsonb,'req-a'),
    (12,now(),$1,$3,'server','tenant_settings','s1','update','{"currency":["USD","CAD"]}'::jsonb,'req-b'),
    (13,now(),$4,$5,'browser','products','p2','insert','{"name":"Other tenant"}'::jsonb,'req-other'),
    (14,now(),NULL,$3,'sql','platform_settings','platform','update','{"cta_color":["red","blue"]}'::jsonb,'req-platform')`, [tenantA, ownerId, supportId, tenantB, otherId])
})

after(async () => { await pool.end(); await admin.end() })

test('owner audit reads remain tenant-scoped and preserve actor privacy', async () => {
  const context = { tenantId: tenantA, role: 'store-admin' as const }
  const rows = await adminMenuTransaction(pool, false, query => readOwnerAuditPage(query, context, { days: 30 }))
  assert.deepEqual(rows.map(row => row.id), ['12', '11'])
  assert.equal(rows[0]?.actor_external, true)
  assert.equal(rows[0]?.actor_name, null)
  assert.equal(rows[1]?.actor_name, 'A Owner')

  const filtered = await adminMenuTransaction(pool, false, query => readOwnerAuditPage(query, context, { table: 'products', actor: ownerId, before: '12', days: 1 }))
  assert.deepEqual(filtered.map(row => row.id), ['11'])
  await assert.rejects(adminMenuTransaction(pool, false, query => readOwnerAuditPage(query, { ...context, role: 'store-staff' }, {})), { status: 403 })
})

test('platform audit reads apply bounded filters and require the platform role', async () => {
  const result = await adminMenuTransaction(pool, false, query => readPlatformAuditPage(query, { role: 'superadmin' }, { table: 'platform_settings', request: 'req-platform', days: 7 }))
  assert.deepEqual(result.rows.map(row => row.id), ['14'])
  assert.equal(result.rows[0]?.tenant_id, null)
  assert.equal(result.tenants.length, 2)
  assert.equal(result.people[0]?.full_name, 'Private Support Name')
  await assert.rejects(adminMenuTransaction(pool, false, query => readPlatformAuditPage(query, { role: 'store-admin' }, {})), { status: 403 })
})
