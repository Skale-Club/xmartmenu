// Historical DDL on an explicit disposable loopback CI database only.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { createAdminMenusPool, adminMenuTransaction } from '../../src/lib/data/admin-menus-runtime'
import { mutateAdminIngredient, readAdminIngredients, readIngredientsPage, type IngredientMutation } from '../../src/lib/data/admin-ingredients'
import type { Ingredient } from '../../src/types/database'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw new Error('Explicit disposable CI database required')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw new Error('Not a disposable ingredient test target')
const admin = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname,
  PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), ingredient = randomUUID(), foreign = randomUUID(), product = randomUUID(), foreignProduct = randomUUID()
const context = { tenantId: a, role: 'store-admin' as const }
const mutate = (input: IngredientMutation, role: 'store-admin' | 'store-staff' = 'store-admin') => adminMenuTransaction(pool, true, query => mutateAdminIngredient(query, { tenantId: a, role }, input))
const list = () => adminMenuTransaction(pool, false, query => readAdminIngredients(query, context))
before(async () => {
  const tables: Array<[string, string]> = [['tenants', '001_initial_schema.sql'], ['categories', '001_initial_schema.sql'],
    ['products', '001_initial_schema.sql'], ['tenant_settings', '001_initial_schema.sql'], ['ingredients', '026_ingredient_schema.sql'], ['product_ingredients', '026_ingredient_schema.sql']]
  await admin.query(`DROP TABLE IF EXISTS ${tables.map(([table]) => `public.${table}`).join(',')} CASCADE`)
  for (const [table, file] of tables) {
    const source = await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')
    const ddl = source.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i'))?.[0]
    assert.ok(ddl, `Historical DDL missing: ${table}`)
    await admin.query(ddl)
  }
  await admin.query('ALTER TABLE public.tenant_settings ADD COLUMN ingredient_customization_enabled boolean NOT NULL DEFAULT false')
  const currency = (await readFile(new URL('../../supabase/migrations/007_store_settings.sql', import.meta.url), 'utf8')).match(/ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS currency[^;]+;/)?.[0]
  assert.ok(currency, 'Historical currency column missing')
  await admin.query(currency)
  await admin.query("INSERT INTO public.tenants(id,slug,name) VALUES($1,'ingredients-a','A'),($2,'ingredients-b','B')", [a, b])
  await admin.query('INSERT INTO public.tenant_settings(tenant_id,currency,ingredient_customization_enabled) VALUES($1,$2,true)', [a, 'BRL'])
  await admin.query("INSERT INTO public.ingredients(id,tenant_id,name,default_extra_price,position) VALUES($1,$2,'Salt',1.25,0),($3,$4,'Foreign',9.99,0)", [ingredient, a, foreign, b])
  await admin.query("INSERT INTO public.products(id,tenant_id,name,price) VALUES($1,$2,'Own product',10),($3,$4,'Foreign product',20)", [product, a, foreignProduct, b])
})
after(async () => { await pool.end(); await admin.end() })
test('restored IDs, numeric prices, settings and staff reads stay tenant-scoped', async () => {
  const page = await adminMenuTransaction(pool, false, query => readIngredientsPage(query, { tenantId: a, role: 'store-staff' }))
  assert.equal(page.ingredients.length, 1)
  assert.equal(page.ingredients[0].id, ingredient)
  assert.equal(page.ingredients[0].default_extra_price, 1.25)
  assert.deepEqual(page.settings, { currency: 'BRL', ingredient_customization_enabled: true })
})
test('create uses server tenant and position; patch preserves IDs and foreign rows', async () => {
  const name = "Pepper'); DELETE FROM ingredients; --"
  const created = await mutate({ kind: 'create', body: { name, default_extra_price: 2.5 } }) as Ingredient
  assert.equal(created.tenant_id, a)
  assert.equal(created.name, name)
  assert.equal(created.position, 1)
  const updated = await mutate({ kind: 'patch', id: created.id, body: { name: 'Pepper', is_available: false } }) as Ingredient
  assert.equal(updated.id, created.id)
  assert.equal(updated.default_extra_price, 2.5)
  assert.equal(updated.is_available, false)
  await assert.rejects(mutate({ kind: 'patch', id: foreign, body: { name: 'No' } }), { status: 404 })
  assert.equal((await admin.query('SELECT name FROM public.ingredients WHERE id=$1', [foreign])).rows[0].name, 'Foreign')
  await assert.rejects(mutate({ kind: 'create', body: { name: 'No' } }, 'store-staff'), { status: 403 })
})
test('reorder swaps current database positions atomically and rolls back a foreign pair', async () => {
  const own = await list(), second = own.find(row => row.id !== ingredient)!
  await mutate({ kind: 'reorder', body: { firstId: ingredient, secondId: second.id } })
  assert.deepEqual((await list()).map(row => row.id), [second.id, ingredient])
  await assert.rejects(mutate({ kind: 'reorder', body: { firstId: ingredient, secondId: foreign } }), { status: 404 })
  assert.deepEqual((await list()).map(row => row.id), [second.id, ingredient])
  await Promise.all([mutate({ kind: 'reorder', body: { firstId: ingredient, secondId: second.id } }), mutate({ kind: 'reorder', body: { firstId: second.id, secondId: ingredient } })])
  assert.deepEqual((await list()).map(row => row.id), [second.id, ingredient])
})
test('deletion refuses corrupt cross-tenant associations then cascades only reviewed own links', async () => {
  await admin.query('INSERT INTO public.product_ingredients(product_id,ingredient_id,tenant_id) VALUES($1,$2,$3),($4,$2,$5)', [product, ingredient, a, foreignProduct, b])
  await assert.rejects(mutate({ kind: 'delete', id: ingredient }), { status: 409 })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.product_ingredients WHERE ingredient_id=$1', [ingredient])).rows[0].n, 2)
  await admin.query('DELETE FROM public.product_ingredients WHERE product_id=$1', [foreignProduct])
  assert.deepEqual(await mutate({ kind: 'delete', id: ingredient }), { ok: true })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.product_ingredients WHERE ingredient_id=$1', [ingredient])).rows[0].n, 0)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.products WHERE id=ANY($1::uuid[])', [[product, foreignProduct]])).rows[0].n, 2)
})
test('an unreviewed cascade refuses deletion even when the new dependent table is empty', async () => {
  const own = (await list())[0]
  await admin.query('CREATE TABLE public.ingredient_extra_dependency(id uuid PRIMARY KEY,ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE CASCADE)')
  try { await assert.rejects(mutate({ kind: 'delete', id: own.id }), { status: 409 }) }
  finally { await admin.query('DROP TABLE public.ingredient_extra_dependency') }
  assert.equal((await list())[0].id, own.id)
})
