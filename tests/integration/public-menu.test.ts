// Explicit disposable CI database only. No dotenv, provider or live migrations.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { PUBLIC_MENU_COLUMNS, readOwnedPublicMenu } from '../../src/lib/data/public-menu'
import { createPublicMenuPool, readPublicMenuSnapshot } from '../../src/lib/data/public-menu-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test'
  || target.search || target.hash) throw Error('Not an isolated catalog test target')
const admin = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })
const reader = createPublicMenuPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname,
  PROD_DATABASE_NAME: 'xmartmenu_identity_test', PUBLIC_MENU_DATABASE_URL: raw, PUBLIC_MENU_DATABASE_SSL: 'disable' })
const ids = Object.fromEntries(['a', 'b', 'menuA', 'menuB', 'private', 'productA', 'productB', 'categoryA', 'groupA', 'ingredientA', 'ingredientB', 'plan'].map(key => [key, randomUUID()]))
const read = (slug = 'restaurant-a', section?: string) => readPublicMenuSnapshot(reader, slug, section)

const tables: Array<[string, string, keyof typeof PUBLIC_MENU_COLUMNS | null]> = [
  ['tenants', '001_initial_schema.sql', 'tenant'], ['tenant_settings', '001_initial_schema.sql', 'settings'],
  ['menus', '009_multiple_menus.sql', 'menu'], ['categories', '001_initial_schema.sql', 'category'],
  ['products', '001_initial_schema.sql', 'product'], ['plans', '030_plans_subscriptions.sql', null],
  ['tenant_subscriptions', '030_plans_subscriptions.sql', null], ['locations', '036_locations.sql', 'location'],
  ['restaurant_tables', '043_tables_waiter.sql', null], ['delivery_zones', '041_delivery_zones.sql', 'zone'],
  ['product_option_groups', '021_orders_v11_schema.sql', 'group'], ['product_options', '021_orders_v11_schema.sql', 'option'],
  ['ingredients', '026_ingredient_schema.sql', 'ingredient'], ['product_ingredients', '026_ingredient_schema.sql', 'productIngredient'],
  ['product_media', '042_product_media.sql', 'media'], ['chat_addon_settings', '044_chat_addon.sql', null],
  ['platform_settings', '004_platform_settings.sql', null],
]

before(async () => {
  // Compose the read boundary from actual historical CREATE/ADD COLUMN clauses.
  // Never execute provider policies, triggers, seeds, ledger writes or backfills.
  // IF NOT EXISTS is added only for duplicate historical ADD COLUMN records.
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()
  const sources = new Map<string, string>()
  for (const file of files) sources.set(file, await readFile(new URL(file, directory), 'utf8'))
  await admin.query(`DROP TABLE IF EXISTS ${tables.map(([table]) => `public.${table}`).join(',')} CASCADE`)
  for (const [table, file] of tables) {
    const pattern = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i')
    const ddl = sources.get(file)?.match(pattern)?.[0]
    assert.ok(ddl, `Historical CREATE TABLE missing: ${table}`)
    await admin.query(ddl)
  }
  const extra: Record<string, string[]> = {
    plans: ['chat_addon_available'], tenant_subscriptions: ['chat_addon_active', 'chat_addon_override'],
    chat_addon_settings: ['text_enabled'],
  }
  for (const [table, , key] of tables) {
    const wanted = key ? PUBLIC_MENU_COLUMNS[key].split(' ') : extra[table] ?? []
    for (const source of sources.values()) {
      const pattern = new RegExp(`ALTER TABLE\\s+(?:public\\.)?${table}\\s+(ADD\\s+COLUMN[\\s\\S]*?);`, 'gi')
      for (const match of source.matchAll(pattern)) {
        const added = [...match[1].matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)].map(item => item[1])
        if (!added.some(column => wanted.includes(column))) continue
        // No selected public field depends on hosted Auth. Refuse expansion into
        // that schema if a future migration changes this fixture's assumptions.
        assert.doesNotMatch(match[0], /REFERENCES\s+(?:auth|storage)\./i)
        const ddl = match[0].replace(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi, 'ADD COLUMN IF NOT EXISTS ')
        await admin.query(ddl)
      }
    }
    const actual = (await admin.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', ['public', table])).rows.map(row => row.column_name)
    for (const column of wanted) assert.ok(actual.includes(column), `Historical projection column missing: ${table}.${column}`)
  }
  await admin.query('ALTER TABLE public.tenant_settings ADD COLUMN private_token text; ALTER TABLE public.platform_settings ADD COLUMN private_token text')
  await admin.query('INSERT INTO public.tenants(id,slug,name) VALUES($1,$2,$3),($4,$5,$6)', [ids.a, 'restaurant-a', 'A', ids.b, 'restaurant-b', 'B'])
  await admin.query(`INSERT INTO public.tenant_settings(tenant_id,orders_enabled,direct_orders_enabled,table_management_enabled,delivery_enabled,ingredient_customization_enabled,private_token)
    VALUES($1,true,true,true,true,true,$3),($2,true,true,true,true,true,$4)`, [ids.a, ids.b, randomUUID(), randomUUID()])
  await admin.query('INSERT INTO public.platform_settings(menu_footer_brand,private_token) VALUES($1,$2)', ['Brand', randomUUID()])
  await admin.query(`INSERT INTO public.menus(id,tenant_id,name,slug,is_default,is_private) VALUES($1,$2,'A','main',true,false),($3,$4,'B','main',true,false),($5,$2,'Private','private',false,true)`, [ids.menuA, ids.a, ids.menuB, ids.b, ids.private])
  await admin.query('INSERT INTO public.categories(id,tenant_id,menu_id,name) VALUES($1,$2,$3,$4)', [ids.categoryA, ids.a, ids.menuA, 'Main'])
  await admin.query(`INSERT INTO public.products(id,tenant_id,menu_id,category_id,name,price) VALUES($1,$2,$3,$4,'A',12.25),($5,$6,$7,NULL,'B',99)`, [ids.productA, ids.a, ids.menuA, ids.categoryA, ids.productB, ids.b, ids.menuB])
  await admin.query(`INSERT INTO public.plans(id,name,slug,monthly_price,annual_price,features,chat_addon_available) VALUES($1,'Paid','paid',1,10,'["payments"]',true)`, [ids.plan])
  await admin.query(`INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status,chat_addon_active) VALUES($1,$2,'monthly','active',true),($3,$2,'monthly','active',false)`, [ids.a, ids.plan, ids.b])
  await admin.query(`INSERT INTO public.chat_addon_settings(tenant_id,enabled,audio_enabled,text_enabled,openrouter_api_key) VALUES($1,true,true,false,$2)`, [ids.a, randomUUID()])
  await admin.query(`INSERT INTO public.product_option_groups(id,product_id,tenant_id,name) VALUES($1,$2,$3,'Sizes')`, [ids.groupA, ids.productA, ids.a])
  await admin.query(`INSERT INTO public.product_options(group_id,tenant_id,name,price_modifier,is_available) VALUES($1,$2,'Visible',2.5,true),($1,$2,'Hidden',8,false),($1,$3,'Foreign',50,true)`, [ids.groupA, ids.a, ids.b])
  await admin.query(`INSERT INTO public.ingredients(id,tenant_id,name) VALUES($1,$2,'Onion'),($3,$4,'Foreign')`, [ids.ingredientA, ids.a, ids.ingredientB, ids.b])
  await admin.query(`INSERT INTO public.product_ingredients(product_id,ingredient_id,tenant_id) VALUES($1,$2,$3),($1,$4,$3)`, [ids.productA, ids.ingredientA, ids.a, ids.ingredientB])
  await admin.query(`INSERT INTO public.product_media(product_id,tenant_id,type,url) VALUES($1,$2,'image','https://media.example.test/a.webp'),($1,$3,'image','https://media.example.test/foreign.webp')`, [ids.productA, ids.a, ids.b])
  await admin.query(`INSERT INTO public.restaurant_tables(tenant_id,name) VALUES($1,'A table'),($2,'B table')`, [ids.a, ids.b])
  await admin.query(`INSERT INTO public.delivery_zones(tenant_id,name) VALUES($1,'A zone'),($2,'B zone')`, [ids.a, ids.b])
})
after(async () => { await reader.end(); await admin.end() })

test('restored historical tables produce complete original-ID numeric public menu DTOs without hosted clients', async () => {
  const result = await read()
  assert.equal(result.kind, 'menu')
  if (result.kind !== 'menu') throw Error()
  assert.equal(result.tenant.id, ids.a)
  assert.equal(result.menu.id, ids.menuA)
  assert.equal(result.products[0].id, ids.productA)
  assert.equal(result.products[0].price, 12.25)
  assert.equal(result.capabilities.guestOrdering, true)
  assert.equal(result.chatAddonEnabled, true)
  assert.equal(result.chatAddonAudioEnabled, true)
  assert.equal(result.chatAddonTextEnabled, false)
  assert.equal(result.tables.length, 1)
  assert.equal(result.deliveryZones.length, 1)
  assert.equal('private_token' in result.tenant.tenant_settings, false)
  assert.equal(JSON.stringify(result).includes('openrouter_api_key'), false)
})
test('every detail join rejects foreign-tenant rows even if legacy simple FKs accept them', async () => {
  const result = await read()
  if (result.kind !== 'menu') throw Error()
  const options = result.optionGroupsByProductId[ids.productA][0].options
  assert.deepEqual(options.map(option => option.name), ['Visible'])
  assert.equal(options[0].price_modifier, 2.5)
  assert.deepEqual(result.productIngredientsByProductId[ids.productA].map(item => item.ingredient.name), ['Onion'])
  assert.deepEqual(result.productMediaByProductId[ids.productA].map(item => item.url), ['https://media.example.test/a.webp'])
  assert.equal(result.products.some(product => product.id === ids.productB), false)
})
test('branch assignment cannot select another tenant menu; root picker retains its public shape', async () => {
  await admin.query(`INSERT INTO public.locations(tenant_id,name,slug,menu_id) VALUES($1,'North','north',$2)`, [ids.a, ids.menuB])
  const branch = await read('restaurant-a', 'north')
  assert.equal(branch.kind === 'menu' && branch.menu.id, ids.menuA)
  await admin.query(`INSERT INTO public.locations(tenant_id,name,slug) VALUES($1,'South','south')`, [ids.a])
  const picker = await read()
  assert.equal(picker.kind, 'branches')
  if (picker.kind !== 'branches') throw Error()
  assert.deepEqual(Object.keys(picker.locations[0]).sort(), ['id', 'name', 'slug', 'address', 'city', 'phone', 'business_hours'].sort())
  await admin.query('DELETE FROM public.locations WHERE tenant_id=$1', [ids.a])
})
test('private-menu marker and product isolation survive selection for the request-level access guard', async () => {
  const result = await read('restaurant-a', 'private')
  assert.equal(result.kind === 'menu' && result.menu.id, ids.private)
  assert.equal(result.kind === 'menu' && result.menu.is_private, true)
  assert.deepEqual(result.kind === 'menu' && result.products, [])
})
test('inactive tenants and unknown sections fail closed; subscription revocation removes paid capabilities', async () => {
  await admin.query('UPDATE public.tenants SET is_active=false WHERE id=$1', [ids.b])
  assert.deepEqual(await read('restaurant-b'), { kind: 'not_found' })
  assert.deepEqual(await read('restaurant-a', 'unknown'), { kind: 'not_found' })
  await admin.query(`UPDATE public.tenant_subscriptions SET status='cancelled' WHERE tenant_id=$1`, [ids.a])
  const result = await read()
  assert.equal(result.kind === 'menu' && result.capabilities.guestOrdering, false)
  assert.deepEqual(result.kind === 'menu' && result.deliveryZones, [])
  await admin.query(`UPDATE public.tenant_subscriptions SET status='active' WHERE tenant_id=$1`, [ids.a])
})
test('a real read-only repeatable-read snapshot stays coherent during concurrent writes', async () => {
  const client = await reader.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    let changed = false
    const result = await readOwnedPublicMenu(async (text, values) => {
      const response = await client.query(text, values)
      if (!changed && text.includes('FROM public.tenants')) {
        changed = true
        await admin.query('UPDATE public.products SET price=44 WHERE id=$1', [ids.productA])
      }
      return response
    }, 'restaurant-a', undefined)
    assert.equal(result.kind === 'menu' && result.products[0].price, 12.25)
    await assert.rejects(client.query('DELETE FROM public.products'), { code: '25006' })
    await client.query('ROLLBACK')
    assert.equal((await read()).kind, 'menu')
    const refreshed = await read()
    assert.equal(refreshed.kind === 'menu' && refreshed.products[0].price, 44)
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release() }
})
test('a staging preview opens only its hidden menu, by token, inside its own restaurant', async () => {
  const preview = (slug: string, token: string) => readPublicMenuSnapshot(reader, slug, undefined, 8_000, { previewToken: token })
  const token = 'tok_' + 'a'.repeat(40), staging = randomUUID(), stagedProduct = randomUUID()
  // Before the schema step the preview fails closed.
  assert.equal((await preview('restaurant-a', token)).kind, 'not_found')
  const migration = await readFile(new URL('../../supabase/migrations/20261111120000_menu_staging.sql', import.meta.url), 'utf8')
  await admin.query(migration)
  await admin.query(`INSERT INTO public.menus(id,tenant_id,name,slug,is_active,is_default,staging_of,preview_token) VALUES($1,$2,'A','main-staging-x',false,false,$3,$4)`, [staging, ids.a, ids.menuA, token])
  await admin.query(`INSERT INTO public.products(id,tenant_id,menu_id,name,price) VALUES($1,$2,$3,'A with 3D',13)`, [stagedProduct, ids.a, staging])
  const result = await preview('restaurant-a', token)
  assert.equal(result.kind, 'menu')
  if (result.kind !== 'menu') throw Error()
  assert.equal(result.menu.id, staging)
  assert.deepEqual(result.products.map(product => product.name), ['A with 3D'])
  assert.equal('preview_token' in result.menu, false)
  assert.equal(JSON.stringify(result).includes(token), false)
  // The live menu is unchanged; another restaurant, a wrong token or a section never open it.
  const live = await read()
  assert.equal(live.kind === 'menu' && live.menu.id, ids.menuA)
  assert.equal((await preview('restaurant-b', token)).kind, 'not_found')
  assert.equal((await preview('restaurant-a', token.replace(/a$/, 'b'))).kind, 'not_found')
  assert.equal((await preview('restaurant-a', "' OR true --")).kind, 'not_found')
  assert.equal((await readPublicMenuSnapshot(reader, 'restaurant-a', 'main-staging-x')).kind, 'not_found')
  // A published (visible, non-staging) menu no longer answers its old token.
  await admin.query('UPDATE public.menus SET staging_of=NULL, is_active=true WHERE id=$1', [staging])
  assert.equal((await preview('restaurant-a', token)).kind, 'not_found')
  await admin.query('DELETE FROM public.menus WHERE id=$1', [staging])
})
test('column-level reader privileges suffice and do not expose unrelated platform settings', async () => {
  await admin.query('CREATE ROLE catalog_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO catalog_reader')
  for (const [table, , key] of tables) {
    const columns = key ? PUBLIC_MENU_COLUMNS[key] : ({
      platform_settings: 'menu_footer_brand', plans: 'id features chat_addon_available', tenant_subscriptions: 'tenant_id plan_id status chat_addon_active chat_addon_override',
      chat_addon_settings: 'tenant_id enabled audio_enabled text_enabled', restaurant_tables: 'id tenant_id name position is_active',
    } as Record<string, string>)[table]
    assert.ok(columns)
    await admin.query(`GRANT SELECT(${columns.split(' ').join(',')}) ON public.${table} TO catalog_reader`)
  }
  const client = await reader.connect()
  try {
    await client.query('SET ROLE catalog_reader')
    const result = await readOwnedPublicMenu((text, values) => client.query(text, values), 'restaurant-a', undefined)
    assert.equal(result.kind, 'menu')
    await assert.rejects(client.query('SELECT private_token FROM public.platform_settings'), { code: '42501' })
    await assert.rejects(client.query('SELECT openrouter_api_key FROM public.chat_addon_settings'), { code: '42501' })
  } finally { await client.query('RESET ROLE'); client.release() }
})
test('the restaurant subdomain joins the public tenant once its column exists', async () => {
  const before = await read()
  assert.equal(before.kind === 'menu' && before.tenant.subdomain, null)
  await admin.query(await readFile(new URL('../../supabase/migrations/20261111140000_tenant_subdomain.sql', import.meta.url), 'utf8'))
  await admin.query("UPDATE public.tenants SET subdomain='restaurant-a' WHERE id=$1", [ids.a])
  const after = await read()
  assert.equal(after.kind === 'menu' && after.tenant.subdomain, 'restaurant-a')
  const other = await read('restaurant-b')
  assert.notEqual(other.kind === 'menu' && other.tenant.subdomain, 'restaurant-a')
})
