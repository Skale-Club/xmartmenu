// Exact historical catalog DDL on a disposable loopback CI database only.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import pg from 'pg'
import { createAdminMenusPool, adminMenuTransaction } from '../../src/lib/data/admin-menus-runtime'
import { mutateAdminProduct, readProductsPage, type AdminProduct, type ProductMutation } from '../../src/lib/data/admin-products'
import { PUBLIC_MENU_COLUMNS } from '../../src/lib/data/public-menu'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw new Error('Explicit disposable CI database required')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw new Error('Not a disposable product test target')
const admin = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname,
  PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), menu = randomUUID(), secondMenu = randomUUID(), foreignMenu = randomUUID()
const category = randomUUID(), otherCategory = randomUUID(), product = randomUUID(), foreignProduct = randomUUID(), ingredient = randomUUID()
const context = { tenantId: a, role: 'store-admin' as const }
const mutate = (input: ProductMutation, role: 'store-admin' | 'store-staff' = 'store-admin') => adminMenuTransaction(pool, true, query => mutateAdminProduct(query, { tenantId: a, role }, input))
const page = (selected?: string) => adminMenuTransaction(pool, false, query => readProductsPage(query, context, selected))
before(async () => {
  const tables: Array<[string, string, keyof typeof PUBLIC_MENU_COLUMNS | null]> = [
    ['tenants', '001_initial_schema.sql', null], ['tenant_settings', '001_initial_schema.sql', null], ['menus', '009_multiple_menus.sql', 'menu'],
    ['categories', '001_initial_schema.sql', 'category'], ['products', '001_initial_schema.sql', 'product'],
    ['product_option_groups', '021_orders_v11_schema.sql', 'group'], ['product_options', '021_orders_v11_schema.sql', 'option'],
    ['ingredients', '026_ingredient_schema.sql', 'ingredient'], ['product_ingredients', '026_ingredient_schema.sql', 'productIngredient'],
    ['product_media', '042_product_media.sql', 'media'], ['locations', '036_locations.sql', null], ['qr_codes', '001_initial_schema.sql', null],
    ['orders', '019_full_schema_sync.sql', null], ['menu_sessions', '20261009010000_menu_analytics_foundation.sql', null], ['menu_events', '20261009010000_menu_analytics_foundation.sql', null],
  ]
  const directory = new URL('../../supabase/migrations/', import.meta.url), sources = new Map<string, string>()
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()) sources.set(file, await readFile(new URL(file, directory), 'utf8'))
  await admin.query(`DROP TABLE IF EXISTS ${tables.map(([table]) => `public.${table}`).join(',')} CASCADE`)
  for (const [table, file] of tables) {
    const ddl = sources.get(file)?.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i'))?.[0]
    assert.ok(ddl, `Historical DDL missing: ${table}`)
    await admin.query(ddl)
  }
  for (const [table, , key] of tables) {
    const wanted = key ? PUBLIC_MENU_COLUMNS[key].split(' ') : table === 'tenant_settings' ? ['currency', 'custom_tags'] : []
    for (const source of sources.values()) for (const match of source.matchAll(new RegExp(`ALTER TABLE\\s+(?:public\\.)?${table}\\s+(ADD\\s+COLUMN[\\s\\S]*?);`, 'gi'))) {
      const added = [...match[1].matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)].map(item => item[1])
      if (!added.some(column => wanted.includes(column))) continue
      assert.doesNotMatch(match[0], /REFERENCES\s+(?:auth|storage)\./i)
      await admin.query(match[0].replace(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi, 'ADD COLUMN IF NOT EXISTS '))
    }
  }
  await admin.query('ALTER TABLE public.products ADD COLUMN private_token text')
  await admin.query("INSERT INTO public.tenants(id,slug,name) VALUES($1,'products-a','A'),($2,'products-b','B')", [a, b])
  await admin.query('INSERT INTO public.tenant_settings(tenant_id,currency,custom_tags) VALUES($1,$2,$3)', [a, 'BRL', ['Spicy']])
  await admin.query("INSERT INTO public.menus(id,tenant_id,name,slug,is_default) VALUES($1,$2,'Main','main',true),($3,$2,'Second','second',false),($4,$5,'Foreign','main',true)", [menu, a, secondMenu, foreignMenu, b])
  await admin.query("INSERT INTO public.categories(id,tenant_id,menu_id,name) VALUES($1,$2,$3,'Own'),($4,$2,$5,'Other menu')", [category, a, menu, otherCategory, secondMenu])
  await admin.query("INSERT INTO public.products(id,tenant_id,menu_id,category_id,name,price,private_token) VALUES($1,$2,$3,$4,'Dish',12.25,$8),($5,$6,$7,NULL,'Foreign',99,NULL)", [product, a, menu, category, foreignProduct, b, foreignMenu, randomUUID()])
  await admin.query("INSERT INTO public.ingredients(id,tenant_id,name) VALUES($1,$2,'Salt')", [ingredient, a])
})
after(async () => { await pool.end(); await admin.end() })
test('restored product IDs/prices, active menu/category and settings preserve DTOs without private columns', async () => {
  const result = await page(foreignMenu)
  assert.equal(result.menu?.id, menu)
  assert.equal(result.products.length, 1)
  assert.equal(result.products[0].id, product)
  assert.equal(result.products[0].price, 12.25)
  assert.deepEqual(result.products[0].category, { id: category, name: 'Own' })
  assert.equal('private_token' in result.products[0], false)
  assert.deepEqual(result.settings, { currency: 'BRL', custom_tags: ['Spicy'] })
  assert.equal((await page(secondMenu)).products.length, 0)
})
test('create uses server tenant/menu/ID/position and refuses stale selection or another menu category', async () => {
  await assert.rejects(mutate({ kind: 'create', body: { name: 'No', price: 1, expectedMenuId: foreignMenu } }), { status: 409 })
  await assert.rejects(mutate({ kind: 'create', body: { name: 'No', price: 1, expectedMenuId: menu, category_id: otherCategory } }), { status: 400 })
  const created = await mutate({ kind: 'create', body: { name: "Dish'); DELETE FROM products; --", price: 0, expectedMenuId: menu } }) as AdminProduct
  assert.equal(created.tenant_id, a)
  assert.equal(created.menu_id, menu)
  assert.equal(created.position, 1)
  assert.equal(created.price, 0)
  await assert.rejects(mutate({ kind: 'create', body: { name: 'No', price: 1, expectedMenuId: menu } }, 'store-staff'), { status: 403 })
})
test('patch preserves identity and scope, supports nullable original price and rejects a foreign product', async () => {
  const updated = await mutate({ kind: 'patch', id: product, body: { price: 13.5, original_price: null, is_available: false } }) as AdminProduct
  assert.equal(updated.id, product)
  assert.equal(updated.category_id, category)
  assert.equal(updated.price, 13.5)
  assert.equal(updated.is_available, false)
  await assert.rejects(mutate({ kind: 'patch', id: foreignProduct, body: { price: 1 } }), { status: 404 })
  assert.equal((await admin.query('SELECT price FROM public.products WHERE id=$1', [foreignProduct])).rows[0].price, '99.00')
})
test('category scope cannot move while its product write is awaiting commit', async () => {
  let admitted!: () => void, finish!: () => void
  const ready = new Promise<void>(resolve => { admitted = resolve })
  const held = new Promise<void>(resolve => { finish = resolve })
  const writing = adminMenuTransaction(pool, true, async query => {
    await mutateAdminProduct(query, context, { kind: 'patch', id: product, body: { category_id: category } })
    admitted()
    await held
  })
  const outside = await admin.connect()
  try {
    await Promise.race([ready, writing])
    await outside.query("SET lock_timeout='100ms'")
    await assert.rejects(outside.query('UPDATE public.categories SET menu_id=$1 WHERE id=$2', [secondMenu, category]), { code: '55P03' })
  } finally {
    finish()
    try { await writing }
    finally {
      try { await outside.query('RESET lock_timeout') }
      finally { outside.release() }
    }
  }
  assert.equal((await admin.query('SELECT menu_id FROM public.categories WHERE id=$1', [category])).rows[0].menu_id, menu)
})
test('deletion refuses a corrupt descendant and otherwise cascades own children without touching storage/products elsewhere', async () => {
  const group = randomUUID()
  await admin.query("INSERT INTO public.product_option_groups(id,product_id,tenant_id,name,type) VALUES($1,$2,$3,'Size','single')", [group, product, a])
  await admin.query("INSERT INTO public.product_options(group_id,tenant_id,name) VALUES($1,$2,'Corrupt')", [group, b])
  await assert.rejects(mutate({ kind: 'delete', id: product }), { status: 409 })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.products WHERE id=$1', [product])).rows[0].n, 1)
  await admin.query('UPDATE public.product_options SET tenant_id=$1 WHERE group_id=$2', [a, group])
  await admin.query('INSERT INTO public.product_ingredients(product_id,ingredient_id,tenant_id) VALUES($1,$2,$3)', [product, ingredient, a])
  await admin.query("INSERT INTO public.product_media(product_id,tenant_id,type,url) VALUES($1,$2,'image','https://media.example.test/retained.webp')", [product, a])
  assert.deepEqual(await mutate({ kind: 'delete', id: product }), { ok: true })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.product_options WHERE group_id=$1', [group])).rows[0].n, 0)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.products WHERE id=$1', [foreignProduct])).rows[0].n, 1)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.ingredients WHERE id=$1', [ingredient])).rows[0].n, 1)
})
test('unreviewed cascading schema changes refuse deletion before any row is changed', async () => {
  const own = (await page()).products[0]
  await admin.query('CREATE TABLE public.product_extra_dependency(id uuid PRIMARY KEY,product_id uuid REFERENCES public.products(id) ON DELETE CASCADE)')
  try { await assert.rejects(mutate({ kind: 'delete', id: own.id }), { status: 409 }) }
  finally { await admin.query('DROP TABLE public.product_extra_dependency') }
  assert.equal((await page()).products[0].id, own.id)
})
