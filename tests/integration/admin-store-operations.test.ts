// Only the disposable, loopback CI database. No dotenv or live migrations.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createAdminQrCode, deleteAdminQrCode, mutateAdminRestaurantTable, readAdminQrCodes, readAdminRestaurantTables } from '../../src/lib/data/admin-store-operations'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated Store operations target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tenantA = randomUUID(), tenantB = randomUUID(), tableA = randomUUID(), tableB = randomUUID(), tableForeign = randomUUID(), qrId = randomUUID(), scanId = randomUUID()
const owner = { tenantId: tenantA, role: 'store-admin' as const }, staff = { tenantId: tenantA, role: 'store-staff' as const }, foreignOwner = { tenantId: tenantB, role: 'store-admin' as const }

before(async () => {
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  const initial = await readFile(new URL('001_initial_schema.sql', directory), 'utf8')
  const tablesMigration = await readFile(new URL('043_tables_waiter.sql', directory), 'utf8')
  await admin.query('DROP TABLE IF EXISTS public.scan_events, public.qr_codes, public.restaurant_tables, public.tenants CASCADE')
  for (const [table, source] of [['tenants', initial], ['qr_codes', initial], ['scan_events', initial], ['restaurant_tables', tablesMigration]] as const) {
    const ddl = source.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i'))?.[0]
    assert.ok(ddl, `Historical DDL missing: ${table}`)
    await admin.query(ddl)
  }
  await admin.query("INSERT INTO public.tenants(id,slug,name) VALUES($1,$2,'A'),($3,$4,'B')", [tenantA, `ops-a-${tenantA}`, tenantB, `ops-b-${tenantB}`])
  await admin.query('INSERT INTO public.restaurant_tables(id,tenant_id,name,position) VALUES($1,$2,\'A1\',0),($3,$2,\'A2\',1),($4,$5,\'B1\',0)', [tableA, tenantA, tableB, tableForeign, tenantB])
  await admin.query("INSERT INTO public.qr_codes(id,tenant_id,label,target_url) VALUES($1,$2,'Front','https://menu.test/a')", [qrId, tenantA])
  await admin.query("INSERT INTO public.scan_events(id,tenant_id,qr_code_id) VALUES($1,$2,$3)", [scanId, tenantA, qrId])
})

after(async () => { await pool.end(); await admin.end() })

test('owned table CRUD derives tenant, permits staff like the existing tenant RLS policy, and reorders atomically', async () => {
  const beforeRows = await adminMenuTransaction(pool, false, query => readAdminRestaurantTables(query, owner))
  assert.deepEqual(beforeRows.map(item => item.id), [tableA, tableB])
  const created = await adminMenuTransaction(pool, true, query => mutateAdminRestaurantTable(query, staff, { kind: 'create', name: '  A3  ' }))
  assert.ok(!Array.isArray(created) && !('ok' in created))
  assert.equal(created.name, 'A3')
  assert.equal(created.tenant_id, tenantA)
  assert.equal(created.position, 2)
  let databaseFailure: { code?: string; column?: string } | undefined
  const diagnosticPool = {
    connect: async () => {
      const client = await pool.connect()
      return {
        query: async (sql: string, values?: unknown[]) => {
          try {
            return await client.query(sql, values)
          } catch (error) {
            const pgError = error as { code?: unknown; column?: unknown }
            databaseFailure = {
              code: typeof pgError.code === 'string' ? pgError.code : undefined,
              column: typeof pgError.column === 'string' ? pgError.column : undefined,
            }
            throw error
          }
        },
        release: (destroy?: boolean) => client.release(destroy),
      } as unknown as pg.PoolClient
    },
  } as Pick<pg.Pool, 'connect'>
  try {
    await adminMenuTransaction(diagnosticPool, true, query => mutateAdminRestaurantTable(query, owner, { kind: 'reorder', firstId: tableA, secondId: tableB }))
  } catch (error) {
    if (databaseFailure) throw new Error(`Reorder SQLSTATE ${databaseFailure.code ?? 'unknown'}; column ${databaseFailure.column ?? 'unknown'}`)
    throw error
  }
  const afterRows = await adminMenuTransaction(pool, false, query => readAdminRestaurantTables(query, owner))
  assert.deepEqual(afterRows.slice(0, 2).map(item => item.id), [tableB, tableA])
  assert.equal(afterRows.length, 3)
  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminRestaurantTable(query, owner, { kind: 'delete', id: tableForeign })), { status: 404 })
})

test('owned QR CRUD is tenant-scoped and preserves scan event ON DELETE SET NULL', async () => {
  const rows = await adminMenuTransaction(pool, false, query => readAdminQrCodes(query, owner))
  assert.deepEqual(rows.map(item => item.id), [qrId])
  const created = await adminMenuTransaction(pool, true, query => createAdminQrCode(query, owner, 'Back patio', 'https://menu.test/a?source=Back%20patio'))
  assert.equal(created.tenant_id, tenantA)
  assert.equal(created.target_url, 'https://menu.test/a?source=Back%20patio')
  await assert.rejects(adminMenuTransaction(pool, true, query => deleteAdminQrCode(query, foreignOwner, qrId)), { status: 404 })
  await adminMenuTransaction(pool, true, query => deleteAdminQrCode(query, owner, qrId))
  assert.equal((await admin.query('SELECT qr_code_id FROM public.scan_events WHERE id=$1', [scanId])).rows[0].qr_code_id, null)
})
