// Only the disposable, loopback CI database. No dotenv or live migrations.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { mutateAdminDeliveryZone, mutateAdminLocation } from '../../src/lib/data/admin-locations'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated admin locations target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tenantA = randomUUID(), tenantB = randomUUID(), menuA = randomUUID(), menuB = randomUUID()
const planA = randomUUID()
const a = { tenantId: tenantA, role: 'store-admin' as const }, b = { tenantId: tenantB, role: 'store-admin' as const }

before(async () => {
  const tables: Array<[string, string]> = [
    ['tenants', '001_initial_schema.sql'], ['menus', '009_multiple_menus.sql'], ['locations', '036_locations.sql'],
    ['plans', '030_plans_subscriptions.sql'], ['tenant_subscriptions', '030_plans_subscriptions.sql'],
    ['delivery_zones', '041_delivery_zones.sql'], ['orders', '019_full_schema_sync.sql'],
  ]
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  const sources = new Map<string, string>()
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()) sources.set(file, await readFile(new URL(file, directory), 'utf8'))
  await admin.query(`DROP TABLE IF EXISTS ${tables.map(([table]) => `public.${table}`).join(',')} CASCADE`)
  for (const [table, file] of tables) {
    const ddl = sources.get(file)?.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i'))?.[0]
    assert.ok(ddl, `Historical DDL missing: ${table}`)
    await admin.query(ddl)
  }
  const locationRouting = sources.get('037_location_routing.sql')?.match(/ALTER TABLE locations\s+ADD COLUMN[\s\S]*?;/i)?.[0]
  assert.ok(locationRouting)
  await admin.query(locationRouting)
  const localSeo = sources.get('053_local_seo_address_geo.sql')?.match(/ALTER TABLE locations\s+ADD COLUMN[\s\S]*?;/i)?.[0]
  assert.ok(localSeo)
  await admin.query(localSeo.replace(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi, 'ADD COLUMN IF NOT EXISTS '))
  const zoneOrderFields = sources.get('041_delivery_zones.sql')?.match(/ALTER TABLE orders\s+ADD COLUMN[\s\S]*?;/i)?.[0]
  assert.ok(zoneOrderFields)
  await admin.query(zoneOrderFields.replace(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi, 'ADD COLUMN IF NOT EXISTS '))
  await admin.query('INSERT INTO public.tenants(id,slug,name) VALUES($1,$2,\'A\'),($3,$4,\'B\')', [tenantA, `location-a-${tenantA}`, tenantB, `location-b-${tenantB}`])
  await admin.query('INSERT INTO public.menus(id,tenant_id,name,slug) VALUES($1,$2,\'Main A\',\'main\'),($3,$4,\'Main B\',\'main\')', [menuA, tenantA, menuB, tenantB])
  await admin.query("INSERT INTO public.plans(id,name,slug,monthly_price,annual_price,features) VALUES($1,'Payments','location-payments',0,0,'[\"payments\"]'::jsonb)", [planA])
  await admin.query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$3,'monthly','active'),($2,$4,'monthly','cancelled')", [tenantA, tenantB, planA, planA])
})

after(async () => { await pool.end(); await admin.end() })

test('location menu references stay tenant-scoped and zone deletion preserves SET NULL while guarding corrupt references', async () => {
  const created = await adminMenuTransaction(pool, true, query => mutateAdminLocation(query, a, {
    kind: 'create', body: { name: ' Downtown ', slug: 'downtown', address: ' 1 Main ', postal_code: '10001', latitude: 40.7, longitude: -73.9, menu_id: menuA },
  }))
  assert.equal(created.tenant_id, tenantA)
  assert.equal(created.name, 'Downtown')
  assert.equal(created.menu_id, menuA)
  assert.equal(created.latitude, 40.7)
  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminLocation(query, a, {
    kind: 'create', body: { name: 'Foreign', slug: 'foreign', menu_id: menuB },
  })), { status: 400 })
  await admin.query('DELETE FROM public.menus WHERE id=$1', [menuA])
  assert.equal((await admin.query('SELECT menu_id FROM public.locations WHERE id=$1', [created.id])).rows[0].menu_id, null)

  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminDeliveryZone(query, b, {
    kind: 'create', body: { name: 'Blocked', fee_cents: 100, zipcode_prefixes: ['9'] },
  })), { status: 403 })
  const forgedZoneId = randomUUID()
  const createdZone = await adminMenuTransaction(pool, true, query => mutateAdminDeliveryZone(query, a, {
    kind: 'create', body: { id: forgedZoneId, tenant_id: tenantB, name: 'Central', fee_cents: 450, zipcode_prefixes: ['100', '1001'] },
  }))
  assert.ok(!('ok' in createdZone))
  assert.equal(createdZone.tenant_id, tenantA)
  assert.equal(createdZone.fee_cents, 450)
  assert.deepEqual(createdZone.zipcode_prefixes, ['100', '1001'])
  assert.notEqual(createdZone.id, forgedZoneId)

  const orderId = randomUUID()
  await admin.query("INSERT INTO public.orders(id,tenant_id,customer_name,customer_phone,total,delivery_zone_id) VALUES($1,$2,'Guest','100',12.5,$3)", [orderId, tenantB, createdZone.id])
  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminDeliveryZone(query, a, { kind: 'delete', id: createdZone.id })), { status: 409 })
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.delivery_zones WHERE id=$1', [createdZone.id])).rows[0].count, 1)
  await admin.query('UPDATE public.orders SET tenant_id=$1 WHERE id=$2', [tenantA, orderId])
  assert.deepEqual(await adminMenuTransaction(pool, true, query => mutateAdminDeliveryZone(query, a, { kind: 'delete', id: createdZone.id })), { ok: true })
  assert.equal((await admin.query('SELECT delivery_zone_id FROM public.orders WHERE id=$1', [orderId])).rows[0].delivery_zone_id, null)
})
