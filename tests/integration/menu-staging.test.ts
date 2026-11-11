// Menu staging on the disposable loopback CI database only (historical DDL +
// supabase/migrations/20261111120000_menu_staging.sql). No dotenv, no live data.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import pg from 'pg'
import { createAdminMenusPool, adminMenuTransaction } from '../../src/lib/data/admin-menus-runtime'
import { mutateAdminMenu, readAdminMenus } from '../../src/lib/data/admin-menus'
import { findPreviewMenuId, mutateMenuStaging, stagingSchemaReady, type MenuStagingMutation, type StagingMenu } from '../../src/lib/data/menu-staging'
import { PUBLIC_MENU_COLUMNS } from '../../src/lib/data/public-menu'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw new Error('Explicit disposable CI database required')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw new Error('Not a disposable staging test target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname,
  PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })

const a = randomUUID(), b = randomUUID(), live = randomUUID(), other = randomUUID(), foreignMenu = randomUUID()
const starters = randomUUID(), mains = randomUUID(), soup = randomUUID(), steak = randomUUID(), wine = randomUUID()
const size = randomUUID(), large = randomUUID(), salt = randomUUID(), branch = randomUUID()
const context = { tenantId: a, role: 'store-admin' as const }
const stage = (mutation: MenuStagingMutation, role: 'store-admin' | 'store-staff' | 'superadmin' = 'store-admin') =>
  adminMenuTransaction(pool, true, query => mutateMenuStaging(query, { tenantId: a, role }, mutation), 8000)
const previewOf = (tenantId: string, token: string) => adminMenuTransaction(pool, false, query => findPreviewMenuId(query, tenantId, token))
const menuRow = async (id: string) => (await admin.query('SELECT id, slug, is_active, is_default, position, staging_of, preview_token, replaced_at FROM public.menus WHERE id=$1', [id])).rows[0]

before(async () => {
  const tables: Array<[string, string, keyof typeof PUBLIC_MENU_COLUMNS | null]> = [
    ['tenants', '001_initial_schema.sql', null], ['menus', '009_multiple_menus.sql', 'menu'],
    ['categories', '001_initial_schema.sql', 'category'], ['products', '001_initial_schema.sql', 'product'],
    ['product_option_groups', '021_orders_v11_schema.sql', 'group'], ['product_options', '021_orders_v11_schema.sql', 'option'],
    ['ingredients', '026_ingredient_schema.sql', 'ingredient'], ['product_ingredients', '026_ingredient_schema.sql', 'productIngredient'],
    ['product_media', '042_product_media.sql', 'media'], ['locations', '036_locations.sql', 'location'],
    ['product_ar_models', '20261107090000_product_ar_models.sql', null],
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
    const wanted = key ? PUBLIC_MENU_COLUMNS[key].split(' ') : table === 'product_ar_models' ? ['scale', 'model_width_cm'] : table === 'orders' ? ['analytics_session_id'] : []
    for (const source of sources.values()) for (const match of source.matchAll(new RegExp(`ALTER TABLE\\s+(?:public\\.)?${table}\\s+(ADD\\s+COLUMN[\\s\\S]*?);`, 'gi'))) {
      const added = [...match[1].matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)].map(item => item[1])
      if (!added.some(column => wanted.includes(column))) continue
      assert.doesNotMatch(match[0], /REFERENCES\s+(?:auth|storage)\./i)
      await admin.query(match[0].replace(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi, 'ADD COLUMN IF NOT EXISTS '))
    }
  }
  // An admin-only column the public projection does not know: the copy must keep it.
  await admin.query('ALTER TABLE public.products ADD COLUMN kitchen_note text')
  assert.equal(await adminMenuTransaction(pool, false, stagingSchemaReady), false)
  await admin.query(sources.get('20261111120000_menu_staging.sql')!)
  await admin.query(sources.get('20261111120000_menu_staging.sql')!) // idempotent
  assert.equal(await adminMenuTransaction(pool, false, stagingSchemaReady), true)

  await admin.query("INSERT INTO public.tenants(id,slug,name) VALUES($1,'staging-a','A'),($2,'staging-b','B')", [a, b])
  await admin.query(`INSERT INTO public.menus(id,tenant_id,name,slug,is_default,is_active,position) VALUES
    ($1,$2,'Main','main',true,true,0),($3,$2,'Drinks','drinks',false,true,1),($4,$5,'Foreign','main',true,true,0)`, [live, a, other, foreignMenu, b])
  await admin.query("INSERT INTO public.categories(id,tenant_id,menu_id,name,position) VALUES($1,$3,$4,'Starters',0),($2,$3,$4,'Mains',1)", [starters, mains, a, live])
  await admin.query(`INSERT INTO public.products(id,tenant_id,menu_id,category_id,name,price,position,upsell_product_ids,kitchen_note) VALUES
    ($1,$4,$5,$6,'Soup',8,0,ARRAY[$2]::uuid[],'hot'),($2,$4,$5,$7,'Steak',30,1,ARRAY[$1,$3]::uuid[],NULL),($3,$4,$8,NULL,'Wine',12,0,'{}',NULL)`,
  [soup, steak, wine, a, live, starters, mains, other])
  await admin.query("INSERT INTO public.product_option_groups(id,product_id,tenant_id,name,type) VALUES($1,$2,$3,'Size','single')", [size, steak, a])
  await admin.query("INSERT INTO public.product_options(id,group_id,tenant_id,name,price_modifier) VALUES($1,$2,$3,'Large',5)", [large, size, a])
  await admin.query("INSERT INTO public.ingredients(id,tenant_id,name) VALUES($1,$2,'Salt')", [salt, a])
  await admin.query('INSERT INTO public.product_ingredients(product_id,ingredient_id,tenant_id,is_default) VALUES($1,$2,$3,true)', [steak, salt, a])
  await admin.query("INSERT INTO public.product_media(product_id,tenant_id,type,url,storage_path) VALUES($1,$2,'image','https://cdn.example/steak.webp',$3)", [steak, a, `${a}/steak.webp`])
  await admin.query("INSERT INTO public.product_ar_models(product_id,tenant_id,glb_url,scale) VALUES($1,$2,'https://cdn.example/steak.glb',1.5)", [steak, a])
  await admin.query("INSERT INTO public.locations(id,tenant_id,name,slug,menu_id) VALUES($1,$2,'Downtown','downtown',$3)", [branch, a, live])
})
after(async () => { await pool.end(); await admin.end() })

let stagingId = '', nextRound = ''
test('create copies every guest-visible row into a hidden staging menu with remapped ids and a preview token', async () => {
  const staging = await stage({ kind: 'create', liveId: live }) as StagingMenu
  stagingId = staging.id
  assert.notEqual(staging.id, live)
  assert.equal(staging.staging_of, live)
  assert.equal(staging.is_active, false)
  assert.equal(staging.is_default, false)
  assert.equal(staging.name, 'Main')
  assert.match(staging.slug, /^main-staging-[a-z0-9]+$/)
  assert.match(staging.preview_token ?? '', /^[A-Za-z0-9_-]{32}$/)

  const categories = (await admin.query('SELECT id, name FROM public.categories WHERE menu_id=$1 ORDER BY position', [staging.id])).rows
  assert.deepEqual(categories.map(row => row.name), ['Starters', 'Mains'])
  assert.ok(categories.every(row => ![starters, mains].includes(row.id)))
  const products = (await admin.query('SELECT id, name, category_id, upsell_product_ids, kitchen_note, price FROM public.products WHERE menu_id=$1 ORDER BY position', [staging.id])).rows
  assert.deepEqual(products.map(row => row.name), ['Soup', 'Steak'])
  const [newSoup, newSteak] = products
  assert.equal(newSoup.category_id, categories[0].id)
  assert.equal(newSteak.category_id, categories[1].id)
  assert.equal(newSoup.kitchen_note, 'hot')
  assert.deepEqual(newSoup.upsell_product_ids, [newSteak.id])
  // Inside the menu remapped; a dish of another menu keeps its id, in order.
  assert.deepEqual(newSteak.upsell_product_ids, [newSoup.id, wine])
  const groups = (await admin.query('SELECT id FROM public.product_option_groups WHERE product_id=$1', [newSteak.id])).rows
  assert.equal(groups.length, 1)
  assert.notEqual(groups[0].id, size)
  assert.equal((await admin.query('SELECT name, price_modifier FROM public.product_options WHERE group_id=$1', [groups[0].id])).rows[0].price_modifier, '5.00')
  assert.equal((await admin.query('SELECT ingredient_id FROM public.product_ingredients WHERE product_id=$1', [newSteak.id])).rows[0].ingredient_id, salt)
  const media = (await admin.query('SELECT url, storage_path FROM public.product_media WHERE product_id=$1', [newSteak.id])).rows
  assert.deepEqual(media, [{ url: 'https://cdn.example/steak.webp', storage_path: `${a}/steak.webp` }])
  const ar = (await admin.query('SELECT glb_url, scale FROM public.product_ar_models WHERE product_id=$1', [newSteak.id])).rows
  assert.deepEqual(ar, [{ glb_url: 'https://cdn.example/steak.glb', scale: '1.5' }])
  // Live untouched.
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.products WHERE menu_id=$1', [live])).rows[0].n, 2)
  assert.equal((await menuRow(live)).is_default, true)
})

test('one open staging per live menu, managers only, never another tenant', async () => {
  await assert.rejects(stage({ kind: 'create', liveId: live }), { status: 409 })
  await assert.rejects(stage({ kind: 'create', liveId: stagingId }), { status: 409 })
  await assert.rejects(stage({ kind: 'create', liveId: other }, 'store-staff'), { status: 403 })
  await assert.rejects(stage({ kind: 'create', liveId: foreignMenu }), { status: 404 })
  await assert.rejects(stage({ kind: 'publish', id: live }), { status: 409 })
  await assert.rejects(stage({ kind: 'publish', id: foreignMenu }), { status: 404 })
})

test('a staging menu cannot be made visible or default except by publishing', async () => {
  const patch = (body: Record<string, unknown>) => adminMenuTransaction(pool, true, query => mutateAdminMenu(query, context, { kind: 'patch', id: stagingId, body }))
  await assert.rejects(patch({ is_active: true }), { status: 409 })
  await assert.rejects(patch({ is_default: true }), { status: 409 })
  await patch({ name: 'Main', description: 'With 3D dishes' })
  await assert.rejects(admin.query('UPDATE public.menus SET is_active=true WHERE id=$1', [stagingId]), { code: '23514' })
  const listed = await adminMenuTransaction(pool, false, query => readAdminMenus(query, context)) as StagingMenu[]
  assert.equal(listed.find(menu => menu.id === stagingId)?.staging_of, live)
  assert.equal(listed.find(menu => menu.id === live)?.staging_of, null)
})

test('the preview link opens only the staging menu of its own restaurant', async () => {
  const token = (await menuRow(stagingId)).preview_token as string
  assert.equal(await previewOf(a, token), stagingId)
  assert.equal(await previewOf(b, token), null)
  assert.equal(await previewOf(a, `${token.slice(0, -1)}x`), null)
  assert.equal(await previewOf(a, "' OR true --"), null)
  const rotated = await stage({ kind: 'rotate-link', id: stagingId }) as StagingMenu
  assert.notEqual(rotated.preview_token, token)
  assert.equal(await previewOf(a, token), null)
  assert.equal(await previewOf(a, rotated.preview_token!), stagingId)
})

test('publish swaps the staging into production and keeps the replaced version for undo', async () => {
  await admin.query("UPDATE public.products SET price=31, name='Steak (3D)' WHERE menu_id=$1 AND name='Steak'", [stagingId])
  const { live: promoted, previous } = await stage({ kind: 'publish', id: stagingId }) as { live: StagingMenu; previous: StagingMenu }
  assert.equal(promoted.id, stagingId)
  assert.equal(promoted.slug, 'main')
  assert.equal(promoted.is_default, true)
  assert.equal(promoted.is_active, true)
  assert.equal(promoted.staging_of, null)
  assert.equal(previous.id, live)
  assert.equal(previous.is_active, false)
  assert.equal(previous.is_default, false)
  assert.equal(previous.staging_of, stagingId)
  assert.ok(previous.replaced_at)
  assert.match(previous.slug, /^main-v[a-z0-9]+$/)
  assert.equal((await admin.query('SELECT menu_id FROM public.locations WHERE id=$1', [branch])).rows[0].menu_id, stagingId)
  const defaults = (await admin.query('SELECT id FROM public.menus WHERE tenant_id=$1 AND is_default', [a])).rows
  assert.deepEqual(defaults, [{ id: stagingId }])
  assert.equal((await admin.query("SELECT price FROM public.products WHERE menu_id=$1 AND name='Steak (3D)'", [stagingId])).rows[0].price, '31.00')
  // The new live menu's old link no longer opens anything; the previous version's link does.
  assert.equal(await previewOf(a, promoted.preview_token!), null)
  assert.equal(await previewOf(a, previous.preview_token!), live)
  // The replaced version is kept for undo only: the next round gets a fresh staging.
  nextRound = (await stage({ kind: 'create', liveId: stagingId }) as StagingMenu).id
  assert.equal((await menuRow(nextRound)).staging_of, stagingId)
  // Other tenants untouched.
  assert.equal((await menuRow(foreignMenu)).slug, 'main')
})

test('publishing the replaced version again is the undo', async () => {
  const { live: restored, previous } = await stage({ kind: 'publish', id: live }) as { live: StagingMenu; previous: StagingMenu }
  assert.equal(restored.id, live)
  assert.equal(restored.slug, 'main')
  assert.equal(restored.is_default, true)
  assert.equal(previous.id, stagingId)
  assert.equal(previous.staging_of, live)
  assert.equal((await admin.query('SELECT menu_id FROM public.locations WHERE id=$1', [branch])).rows[0].menu_id, live)
  // Every other copy follows the live menu.
  assert.equal((await menuRow(nextRound)).staging_of, live)
})

test('discarding a staging copy deletes only its own rows and keeps the shared files', async () => {
  const before = (await admin.query('SELECT count(*)::int AS n FROM public.product_ar_models')).rows[0].n
  await adminMenuTransaction(pool, true, query => mutateAdminMenu(query, context, { kind: 'delete', id: stagingId }))
  assert.equal(await menuRow(stagingId), undefined)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.product_ar_models')).rows[0].n, before - 1)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.products WHERE menu_id=$1', [live])).rows[0].n, 2)
  assert.equal((await admin.query('SELECT glb_url FROM public.product_ar_models WHERE product_id=$1', [steak])).rows[0].glb_url, 'https://cdn.example/steak.glb')
  // Deleting a live menu leaves its staging as an ordinary hidden menu.
  const drinksStaging = await stage({ kind: 'create', liveId: other }) as StagingMenu
  await adminMenuTransaction(pool, true, query => mutateAdminMenu(query, context, { kind: 'delete', id: other }))
  const orphan = await menuRow(drinksStaging.id)
  assert.equal(orphan.staging_of, null)
  assert.equal(orphan.is_active, false)
})
