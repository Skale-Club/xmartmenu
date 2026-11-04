// Exact historical catalog DDL on a disposable loopback CI database only.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import pg from 'pg'
import { createAdminMenusPool, adminMenuTransaction } from '../../src/lib/data/admin-menus-runtime'
import { mutateAdminProduct, readProductsPage, type AdminProduct, type ProductMutation } from '../../src/lib/data/admin-products'
import { PUBLIC_MENU_COLUMNS } from '../../src/lib/data/public-menu'
import { mutateProductDetail, readProductDetailPage, type DetailOperation } from '../../src/lib/data/admin-product-detail'
import { updateAdminProductUpsellIds } from '../../src/lib/data/admin-product-upsell'
import type { ProductMedia } from '../../src/types/database'
import type { GroupWithOptions } from '../../src/app/(admin)/menu/products/[id]/page'

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
const detail = (productId: string, operation: DetailOperation, role: 'store-admin' | 'store-staff' = 'store-admin') => adminMenuTransaction(pool, operation.action !== 'list', query => mutateProductDetail(query, { tenantId: a, role }, productId, operation))
before(async () => {
  const tables: Array<[string, string, keyof typeof PUBLIC_MENU_COLUMNS | null]> = [
    ['tenants', '001_initial_schema.sql', null], ['tenant_settings', '001_initial_schema.sql', null], ['menus', '009_multiple_menus.sql', 'menu'],
    ['categories', '001_initial_schema.sql', 'category'], ['products', '001_initial_schema.sql', 'product'],
    ['product_option_groups', '021_orders_v11_schema.sql', 'group'], ['product_options', '021_orders_v11_schema.sql', 'option'],
    ['ingredients', '026_ingredient_schema.sql', 'ingredient'], ['product_ingredients', '026_ingredient_schema.sql', 'productIngredient'],
    ['product_media', '042_product_media.sql', 'media'], ['locations', '036_locations.sql', null], ['qr_codes', '001_initial_schema.sql', null],
    ['plans', '030_plans_subscriptions.sql', null], ['tenant_subscriptions', '030_plans_subscriptions.sql', null],
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
    const wanted = key ? PUBLIC_MENU_COLUMNS[key].split(' ') : table === 'tenant_settings' ? ['currency', 'custom_tags', 'ingredient_customization_enabled'] : []
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
test('detail reads and option mutations retain group semantics and signed numeric modifiers', async () => {
  const own = (await page()).products[0]
  const data = await adminMenuTransaction(pool, false, query => readProductDetailPage(query, context, own.id))
  assert.equal(data.product.id, own.id)
  assert.equal(data.menu?.id, menu)
  assert.equal(data.settings.currency, 'BRL')
  let groups = await detail(own.id, { entity: 'groups', action: 'create', values: { name: 'Extras', type: 'multiple', required: false, min_selections: 0, max_selections: null } }) as GroupWithOptions[]
  const extras = groups.find(group => group.name === 'Extras')!
  assert.equal(extras.price_rule, 'max')
  groups = await detail(own.id, { entity: 'options', action: 'create', groupId: extras.id,
    values: { name: 'Discount', base_price: null, price_modifier: -2.25, is_available: true } }) as GroupWithOptions[]
  const discount = groups.find(group => group.id === extras.id)!.options[0]
  assert.equal(discount.price_modifier, -2.25)
  assert.equal(discount.base_price, null)
  groups = await detail(own.id, { entity: 'options', action: 'patch', id: discount.id, values: { is_available: false } }) as GroupWithOptions[]
  assert.equal(groups[0].options[0].is_available, false)
  await assert.rejects(detail(own.id, { entity: 'options', action: 'patch', id: discount.id, values: { price_modifier: 1 } }, 'store-staff'), { status: 403 })
})
test('option ownership follows the product and tenant; reorder uses current database positions', async () => {
  const own = (await page()).products[0]
  let groups = await detail(own.id, { entity: 'groups', action: 'create', values: { name: 'Size', type: 'single' } }) as GroupWithOptions[]
  const size = groups.find(group => group.name === 'Size')!, extras = groups.find(group => group.name === 'Extras')!
  groups = await detail(own.id, { entity: 'options', action: 'create', groupId: size.id, values: { name: 'Small', base_price: 8, price_modifier: 0 } }) as GroupWithOptions[]
  groups = await detail(own.id, { entity: 'options', action: 'create', groupId: size.id, values: { name: 'Large', base_price: 12.5, price_modifier: 0 } }) as GroupWithOptions[]
  const options = groups.find(group => group.id === size.id)!.options
  await assert.rejects(detail(own.id, { entity: 'options', action: 'reorder', groupId: size.id, firstId: options[0].id, secondId: extras.options[0].id }), { status: 404 })
  groups = await detail(own.id, { entity: 'options', action: 'reorder', groupId: size.id, firstId: options[0].id, secondId: options[1].id }) as GroupWithOptions[]
  assert.deepEqual(groups.find(group => group.id === size.id)!.options.map(option => option.id), [options[1].id, options[0].id])
  groups = await detail(own.id, { entity: 'groups', action: 'reorder', firstId: size.id, secondId: extras.id }) as GroupWithOptions[]
  assert.equal(groups[0].id, size.id)
  const otherGroup = randomUUID(), otherOption = randomUUID()
  await admin.query("INSERT INTO public.product_option_groups(id,product_id,tenant_id,name,type) VALUES($1,$2,$3,'Foreign','single')", [otherGroup, foreignProduct, b])
  await admin.query("INSERT INTO public.product_options(id,group_id,tenant_id,name) VALUES($1,$2,$3,'Foreign')", [otherOption, otherGroup, b])
  await assert.rejects(detail(own.id, { entity: 'options', action: 'patch', id: otherOption, values: { price_modifier: 1 } }), { status: 404 })
})
test('ingredient associations require both parents, preserve overrides on repeated create and reject corrupt scopes', async () => {
  const own = (await page()).products[0], other = randomUUID()
  await admin.query("INSERT INTO public.ingredients(id,tenant_id,name) VALUES($1,$2,'Foreign')", [other, b])
  await assert.rejects(detail(own.id, { entity: 'ingredients', action: 'create', ingredientId: other, values: {} }), { status: 404 })
  await detail(own.id, { entity: 'ingredients', action: 'create', ingredientId: ingredient, values: {} })
  await detail(own.id, { entity: 'ingredients', action: 'patch', ingredientId: ingredient, values: { is_default: true, extra_price_override: 1.75 } })
  await detail(own.id, { entity: 'ingredients', action: 'create', ingredientId: ingredient, values: {} })
  const row = (await admin.query('SELECT is_default,extra_price_override FROM public.product_ingredients WHERE product_id=$1 AND ingredient_id=$2', [own.id, ingredient])).rows[0]
  assert.equal(row.is_default, true); assert.equal(row.extra_price_override, '1.75')
  await admin.query('UPDATE public.product_ingredients SET tenant_id=$1 WHERE product_id=$2 AND ingredient_id=$3', [b, own.id, ingredient])
  await assert.rejects(detail(own.id, { entity: 'ingredients', action: 'delete', ingredientId: ingredient }), { status: 409 })
  await admin.query('UPDATE public.product_ingredients SET tenant_id=$1 WHERE product_id=$2 AND ingredient_id=$3', [a, own.id, ingredient])
  assert.deepEqual(await detail(own.id, { entity: 'ingredients', action: 'delete', ingredientId: ingredient }), [])
})
test('gallery metadata syncs primary image atomically, retains video-only legacy image and clears only the last deleted image', async () => {
  const own = (await page()).products[0]
  await admin.query('UPDATE public.products SET image_url=$1 WHERE id=$2', ['https://media.example.test/legacy.webp', own.id])
  let media = await detail(own.id, { entity: 'media', action: 'create', values: [{ type: 'video', url: 'https://media.example.test/video.mp4' }] }) as ProductMedia[]
  const primary = async () => (await admin.query('SELECT image_url FROM public.products WHERE id=$1', [own.id])).rows[0].image_url
  assert.equal(await primary(), 'https://media.example.test/legacy.webp')
  media = await detail(own.id, { entity: 'media', action: 'create', values: [{ type: 'image', url: 'https://media.example.test/a.webp' }, { type: 'image', url: 'https://media.example.test/b.webp' }] }) as ProductMedia[]
  const first = media.find(item => item.url.endsWith('/a.webp'))!, second = media.find(item => item.url.endsWith('/b.webp'))!
  assert.equal(await primary(), first.url)
  await detail(own.id, { entity: 'media', action: 'reorder', firstId: first.id, secondId: second.id })
  assert.equal(await primary(), second.url)
  await detail(own.id, { entity: 'media', action: 'delete', id: second.id })
  assert.equal(await primary(), first.url)
  await detail(own.id, { entity: 'media', action: 'delete', id: first.id })
  assert.equal(await primary(), null)
  assert.equal((await detail(own.id, { entity: 'media', action: 'list' }, 'store-staff') as ProductMedia[]).length, 1)
  await assert.rejects(detail(own.id, { entity: 'media', action: 'create', values: [{ type: 'image', url: 'https://media.example.test/valid.webp' }, { type: 'video', url: 'javascript:bad' }] }), { status: 400 })
  assert.equal((await detail(own.id, { entity: 'media', action: 'list' }) as ProductMedia[]).length, 1)
})
test('deleting a group keeps the reviewed cascade while refusing unreviewed child schema', async () => {
  const own = (await page()).products[0]
  const data = await adminMenuTransaction(pool, false, query => readProductDetailPage(query, context, own.id))
  const targetGroup = data.groups.find(group => group.name === 'Size')!
  await admin.query('CREATE TABLE public.option_group_extra_dependency(id uuid PRIMARY KEY,group_id uuid REFERENCES public.product_option_groups(id) ON DELETE CASCADE)')
  try { await assert.rejects(detail(own.id, { entity: 'groups', action: 'delete', id: targetGroup.id }), { status: 409 }) }
  finally { await admin.query('DROP TABLE public.option_group_extra_dependency') }
  const groups = await detail(own.id, { entity: 'groups', action: 'delete', id: targetGroup.id }) as GroupWithOptions[]
  assert.equal(groups.some(group => group.id === targetGroup.id), false)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.product_options WHERE group_id=$1', [targetGroup.id])).rows[0].n, 0)
})

test('translations commit as one tenant-scoped operation and refuse a foreign child before changing text', async () => {
  const own = (await page()).products[0]
  const groups = await detail(own.id, { entity: 'groups', action: 'create', values: { name: 'Translated group' } }) as GroupWithOptions[]
  const target = groups.find(row => row.name === 'Translated group')!
  const updated = await detail(own.id, { entity: 'options', action: 'create', groupId: target.id, values: { name: 'Translated option' } }) as GroupWithOptions[]
  const optionId = updated.find(row => row.id === target.id)!.options[0].id
  const values = { product: { pt: { name: 'Prato', description: 'Descrição' } }, groups: { [target.id]: { pt: { name: 'Grupo' } } }, options: { [optionId]: { pt: { name: 'Opção' } } } }
  await detail(own.id, { entity: 'translations', action: 'patch', values })
  let data = await adminMenuTransaction(pool, false, query => readProductDetailPage(query, context, own.id))
  assert.deepEqual(data.product.translations, values.product)
  assert.deepEqual(data.groups.find(row => row.id === target.id)!.translations, values.groups[target.id])
  assert.deepEqual(data.groups.find(row => row.id === target.id)!.options[0].translations, values.options[optionId])
  await assert.rejects(detail(own.id, { entity: 'translations', action: 'patch', values: { ...values, product: { pt: { name: 'Must roll back' } }, options: { [randomUUID()]: {} } } }), { status: 404 })
  data = await adminMenuTransaction(pool, false, query => readProductDetailPage(query, context, own.id))
  assert.deepEqual(data.product.translations, values.product)
  await assert.rejects(detail(own.id, { entity: 'translations', action: 'patch', values }, 'store-staff'), { status: 403 })
})

test('product plan metadata follows the current own subscription and revokes cancelled features', async () => {
  const own = (await page()).products[0], plan = randomUUID()
  await admin.query("INSERT INTO public.plans(id,name,slug,monthly_price,annual_price,features) VALUES($1,'Catalog plan','catalog-test',1,10,'[\"payments\"]')", [plan])
  await admin.query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$2,'monthly','active')", [a, plan])
  const read = () => adminMenuTransaction(pool, false, query => readProductDetailPage(query, context, own.id))
  assert.equal((await read()).plan.payments, true)
  await admin.query("UPDATE public.tenant_subscriptions SET status='cancelled' WHERE tenant_id=$1", [a])
  assert.equal((await read()).plan.payments, false)
})

test('upsell writes preserve ordered IDs and reject foreign menu or tenant candidates', async () => {
  const own = (await page()).products[0], candidate = randomUUID(), other = randomUUID()
  await admin.query("INSERT INTO public.products(id,tenant_id,menu_id,name,price) VALUES($1,$2,$3,'Suggestion',2),($4,$2,$5,'Other menu',3)", [candidate, a, menu, other, secondMenu])
  const write = (ids: string[]) => adminMenuTransaction(pool, true, query => updateAdminProductUpsellIds(query, context, own.id, ids))
  await write([candidate])
  assert.deepEqual((await page()).products.find(row => row.id === own.id)!.upsell_product_ids, [candidate])
  for (const ids of [[foreignProduct], [other], [own.id], [candidate, candidate]]) await assert.rejects(write(ids), { status: 400 })
  assert.deepEqual((await page()).products.find(row => row.id === own.id)!.upsell_product_ids, [candidate])
  await write([])
})
