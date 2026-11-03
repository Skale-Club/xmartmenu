// Only the disposable, loopback CI database. No dotenv or live migrations.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { Menu } from '../../src/types/database'
import { activeAdminMenu, findAdminMenu, mutateAdminMenu, readAdminMenus, type AdminMenuMutation, type AdminMenuQuery } from '../../src/lib/data/admin-menus'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated admin menu target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), original = randomUUID(), other = randomUUID()
const context = { tenantId: a, role: 'store-admin' as const }
const mutation = (input: AdminMenuMutation, role = context.role as 'store-admin' | 'store-staff' | 'superadmin') => adminMenuTransaction(pool, true, query => mutateAdminMenu(query, { tenantId: a, role }, input))
const list = () => adminMenuTransaction(pool, false, query => readAdminMenus(query, context))
const tables: Array<[string, string]> = [
  ['tenants', '001_initial_schema.sql'], ['menus', '009_multiple_menus.sql'],
  ['categories', '001_initial_schema.sql'], ['products', '001_initial_schema.sql'],
  ['product_option_groups', '021_orders_v11_schema.sql'], ['product_options', '021_orders_v11_schema.sql'],
  ['ingredients', '026_ingredient_schema.sql'], ['product_ingredients', '026_ingredient_schema.sql'], ['product_media', '042_product_media.sql'],
  ['locations', '036_locations.sql'], ['qr_codes', '001_initial_schema.sql'], ['orders', '019_full_schema_sync.sql'],
  ['menu_sessions', '20261009010000_menu_analytics_foundation.sql'], ['menu_events', '20261009010000_menu_analytics_foundation.sql'],
]
before(async () => {
  // Exact historical CREATE clauses and selected ALTERs; no policy, Auth schema,
  // seed/backfill, trigger, provider or ledger operation is executed.
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  await admin.query(`DROP TABLE IF EXISTS ${tables.map(([table]) => `public.${table}`).join(',')} CASCADE`)
  for (const [table, file] of tables) {
    const source = await readFile(new URL(file, directory), 'utf8')
    const ddl = source.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i'))?.[0]
    assert.ok(ddl, `Historical DDL missing: ${table}`)
    await admin.query(ddl)
  }
  for (const [file, selected] of [
    ['009_multiple_menus.sql', ['categories', 'products']], ['012_menu_i18n.sql', ['menus']],
    ['040_menu_privacy.sql', ['menus']], ['037_location_routing.sql', ['locations']],
    ['20261009010000_menu_analytics_foundation.sql', ['orders']],
  ] as Array<[string, string[]]>) {
    const source = await readFile(new URL(file, directory), 'utf8')
    for (const table of selected) {
      const statements = [...source.matchAll(new RegExp(`ALTER TABLE\\s+${table}\\s+ADD\\s+COLUMN[\\s\\S]*?;`, 'gi'))]
      assert.ok(statements.length)
      for (const statement of statements) await admin.query(statement[0])
    }
  }
  await admin.query('ALTER TABLE public.menus ADD COLUMN private_token text; ALTER TABLE public.menus ADD CONSTRAINT reject_test_name CHECK(name<>\'rollback-test\')')
  await admin.query('INSERT INTO public.tenants(id,slug,name) VALUES($1,\'admin-a\',\'A\'),($2,\'admin-b\',\'B\')', [a, b])
  await admin.query(`INSERT INTO public.menus(id,tenant_id,name,slug,is_default,is_active,price_multiplier,private_token) VALUES($1,$2,'Original','main',true,false,1.25,$5),($3,$4,'Foreign','main',true,true,$6,$5)`, [original, a, other, b, randomUUID(), 1.5])
})
after(async () => { await pool.end(); await admin.end() })

test('admin list preserves restored IDs, inactive selection and numeric DTOs without private columns', async () => {
  const menus = await list()
  assert.equal(menus.length, 1)
  assert.equal(menus[0].id, original)
  assert.equal(menus[0].price_multiplier, 1.25)
  assert.equal(menus[0].is_active, false)
  assert.equal('private_token' in menus[0], false)
  assert.equal(activeAdminMenu(menus, other)?.id, original)
})

test('create scopes tenant/server IDs and keeps language/translation plus duplicate-slug behavior', async () => {
  const body = { name: 'Dinner', tenant_id: b, id: other, language: 'pt', supported_languages: ['pt', 'en'], translations: { pt: { name: ' Jantar ' } } }
  const first = await mutation({ kind: 'create', body }) as Menu
  const second = await mutation({ kind: 'create', body }) as Menu
  assert.equal(first.tenant_id, a)
  assert.notEqual(first.id, other)
  assert.equal(first.slug, 'dinner')
  assert.match(second.slug, /^dinner-[a-z0-9]+$/)
  assert.deepEqual(first.supported_languages, ['pt', 'en'])
  assert.deepEqual(first.translations, { pt: { name: 'Jantar' } })
})

test('patch keeps IDs/slugs, promotes exactly one own default and leaves another tenant unchanged', async () => {
  const created = await mutation({ kind: 'create', body: { name: 'Default candidate' } }) as Menu
  const updated = await mutation({ kind: 'patch', id: created.id, body: { is_default: true, name: 'Renamed', price_multiplier: 1.15, tenant_id: b, slug: 'changed' } }) as Menu
  assert.equal(updated.id, created.id)
  assert.equal(updated.slug, created.slug)
  assert.equal(updated.price_multiplier, 1.15)
  assert.equal((await list()).filter(menu => menu.is_default).length, 1)
  assert.equal((await admin.query('SELECT is_default FROM public.menus WHERE id=$1', [other])).rows[0].is_default, true)
  await mutation({ kind: 'patch', id: original, body: { is_default: true } })
})

test('staff writes fail closed despite privileged database login and foreign IDs stay hidden', async () => {
  await assert.rejects(mutation({ kind: 'create', body: { name: 'No' } }, 'store-staff'), { status: 403 })
  await assert.rejects(mutation({ kind: 'patch', id: original, body: { name: 'No' } }, 'store-staff'), { status: 403 })
  await assert.rejects(mutation({ kind: 'delete', id: other }, 'store-staff'), { status: 404 })
  await assert.rejects(mutation({ kind: 'patch', id: other, body: { name: 'No' } }), { status: 404 })
  assert.equal(await adminMenuTransaction(pool, false, query => findAdminMenu(query, context, other)), null)
})

test('constraint failure after unsetting default rolls back the entire promotion without retry', async () => {
  const created = await mutation({ kind: 'create', body: { name: 'Atomic candidate' } }) as Menu
  await assert.rejects(mutation({ kind: 'patch', id: created.id, body: { is_default: true, name: 'rollback-test' } }), { status: 503 })
  assert.equal((await list()).find(menu => menu.is_default)?.id, original)
  assert.equal((await list()).find(menu => menu.id === created.id)?.name, 'Atomic candidate')
})

test('concurrent own promotions serialize and leave exactly one default', async () => {
  const first = await mutation({ kind: 'create', body: { name: 'Concurrent one' } }) as Menu
  const second = await mutation({ kind: 'create', body: { name: 'Concurrent two' } }) as Menu
  await Promise.all([mutation({ kind: 'patch', id: first.id, body: { is_default: true } }), mutation({ kind: 'patch', id: second.id, body: { is_default: true } })])
  assert.equal((await list()).filter(menu => menu.is_default).length, 1)
  await mutation({ kind: 'patch', id: original, body: { is_default: true } })
})

test('deletion refuses defaults and corrupt tenant descendants before any cascade', async () => {
  await assert.rejects(mutation({ kind: 'delete', id: original }), { status: 400 })
  const created = await mutation({ kind: 'create', body: { name: 'Cascade guard' } }) as Menu
  const productId = randomUUID(), groupId = randomUUID()
  await admin.query(`INSERT INTO public.products(id,tenant_id,menu_id,name,price) VALUES($1,$2,$3,'Dish',10)`, [productId, a, created.id])
  await admin.query(`INSERT INTO public.product_option_groups(id,product_id,tenant_id,name) VALUES($1,$2,$3,'Group')`, [groupId, productId, a])
  const option = await admin.query(`INSERT INTO public.product_options(group_id,tenant_id,name) VALUES($1,$2,'Foreign leaf') RETURNING id`, [groupId, b])
  await assert.rejects(mutation({ kind: 'delete', id: created.id }), { status: 409 })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menus WHERE id=$1', [created.id])).rows[0].n, 1)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.product_options WHERE id=$1', [option.rows[0].id])).rows[0].n, 1)
  await admin.query('UPDATE public.product_options SET tenant_id=$1 WHERE id=$2', [a, option.rows[0].id])
  assert.deepEqual(await mutation({ kind: 'delete', id: created.id }), { ok: true })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.product_options WHERE id=$1', [option.rows[0].id])).rows[0].n, 0)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menus WHERE id=$1', [other])).rows[0].n, 1)
})

test('locked affected leaf blocks a concurrent tenant-only update even when its FK is unchanged', async () => {
  const created = await mutation({ kind: 'create', body: { name: 'Concurrent cascade guard' } }) as Menu
  const productId = randomUUID(), groupId = randomUUID()
  await admin.query(`INSERT INTO public.products(id,tenant_id,menu_id,name,price) VALUES($1,$2,$3,'Dish',10)`, [productId, a, created.id])
  await admin.query(`INSERT INTO public.product_option_groups(id,product_id,tenant_id,name) VALUES($1,$2,$3,'Group')`, [groupId, productId, a])
  const option = (await admin.query(`INSERT INTO public.product_options(group_id,tenant_id,name) VALUES($1,$2,'Own leaf') RETURNING id`, [groupId, a])).rows[0].id
  const competitor = await admin.connect()
  let checked = false
  try {
    await competitor.query("BEGIN; SET LOCAL lock_timeout='75ms'")
    await adminMenuTransaction(pool, true, async query => {
      const instrumented: AdminMenuQuery = async (text, values) => {
        if (text.startsWith('DELETE FROM public.menus')) {
          checked = true
          await assert.rejects(competitor.query('UPDATE public.product_options SET tenant_id=$1 WHERE id=$2', [b, option]), { code: '55P03' })
          await competitor.query('ROLLBACK')
        }
        return query(text, values)
      }
      return mutateAdminMenu(instrumented, context, { kind: 'delete', id: created.id })
    })
    assert.equal(checked, true)
  } finally { await competitor.query('ROLLBACK'); competitor.release() }
})

test('read-only default and configured statement/lock limits remain enforced outside explicit writes', async () => {
  const client = await pool.connect()
  try {
    assert.equal((await client.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only, 'on')
    assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout, '5s')
    assert.equal((await client.query('SHOW lock_timeout')).rows[0].lock_timeout, '2s')
    await assert.rejects(client.query('DELETE FROM public.menus'), { code: '25006' })
  } finally { client.release() }
})

test('an unreviewed new cascading foreign key refuses deletion without touching either tenant', async () => {
  const created = await mutation({ kind: 'create', body: { name: 'Schema drift guard' } }) as Menu
  await admin.query('CREATE TABLE public.unreviewed_menu_child(id uuid PRIMARY KEY, menu_id uuid REFERENCES public.menus(id) ON DELETE CASCADE, tenant_id uuid)')
  try {
    await admin.query('INSERT INTO public.unreviewed_menu_child VALUES($1,$2,$3)', [randomUUID(), created.id, b])
    await assert.rejects(mutation({ kind: 'delete', id: created.id }), { status: 409, message: 'Menu has unreviewed dependent references' })
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.unreviewed_menu_child')).rows[0].n, 1)
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menus WHERE id=$1', [created.id])).rows[0].n, 1)
  } finally { await admin.query('DROP TABLE public.unreviewed_menu_child') }
})
