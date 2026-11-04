// Isolated loopback CI database only; uses a minimal fixture derived from historical table DDL.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
import { mutateAdminCategory, readAdminCategoriesPage, type CategoryMutation } from '../../src/lib/data/admin-categories'
import type { Category } from '../../src/types/database'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw new Error('Explicit disposable CI database required')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw new Error('Not a disposable category test target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname,
  PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), menuA = randomUUID(), menuB = randomUUID(), foreignMenu = randomUUID()
const context = { tenantId: a, role: 'store-admin' as const }
const mutate = (input: CategoryMutation, role: 'store-admin' | 'store-staff' = 'store-admin') =>
  adminMenuTransaction(pool, true, query => mutateAdminCategory(query, { tenantId: a, role }, input))
const list = (selected?: string) => adminMenuTransaction(pool, false, query => readAdminCategoriesPage(query, context, selected))

before(async () => {
  const migrations = new URL('../../supabase/migrations/', import.meta.url)
  await admin.query('DROP TABLE IF EXISTS public.menu_events,public.products,public.categories,public.menus,public.tenants CASCADE')
  for (const [table, file] of [['tenants', '001_initial_schema.sql'], ['categories', '001_initial_schema.sql'], ['products', '001_initial_schema.sql'], ['menus', '009_multiple_menus.sql']] as const) {
    const source = await readFile(new URL(file, migrations), 'utf8')
    const ddl = source.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i'))?.[0]
    assert.ok(ddl, `Historical DDL missing for ${table}`)
    await admin.query(ddl)
  }
  await admin.query('ALTER TABLE public.categories ADD COLUMN menu_id uuid REFERENCES public.menus(id) ON DELETE CASCADE, ADD COLUMN translations jsonb NOT NULL DEFAULT \'{}\', ADD COLUMN course text CHECK(course IS NULL OR course IN (\'main\',\'side\',\'drink\',\'dessert\')), ADD COLUMN private_note text')
  await admin.query("ALTER TABLE public.menus ADD COLUMN supported_languages text[] NOT NULL DEFAULT ARRAY['en'], ADD COLUMN translations jsonb NOT NULL DEFAULT '{}', ADD COLUMN is_private boolean NOT NULL DEFAULT false, ADD COLUMN price_multiplier numeric(5,2) NOT NULL DEFAULT 1")
  await admin.query('ALTER TABLE public.products ADD COLUMN menu_id uuid REFERENCES public.menus(id) ON DELETE CASCADE')
  await admin.query('CREATE TABLE public.menu_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL)')
  await admin.query("INSERT INTO public.tenants(id,slug,name) VALUES($1,'category-a','A'),($2,'category-b','B')", [a, b])
  await admin.query("INSERT INTO public.menus(id,tenant_id,name,slug,is_default,supported_languages) VALUES($1,$2,'Main','main',true,ARRAY['en','fr']),($3,$4,'Foreign','main',true,ARRAY['en']),($5,$2,'Second','second',false,ARRAY['en'])", [menuA, a, foreignMenu, b, menuB])
})
after(async () => { await pool.end(); await admin.end() })

test('page selects only the requested tenant menu with explicit category projection', async () => {
  await admin.query("INSERT INTO public.categories(id,tenant_id,menu_id,name,position,private_note) VALUES($1,$2,$3,'Soup',1,'must not escape')", [randomUUID(), a, menuA])
  await admin.query("INSERT INTO public.categories(tenant_id,menu_id,name,position) VALUES($1,$2,'Foreign',0)", [b, foreignMenu])
  const page = await list(menuA)
  assert.equal(page.menu?.id, menuA)
  assert.equal(page.categories.length, 1)
  assert.equal(page.categories[0].name, 'Soup')
  assert.equal('private_note' in page.categories[0], false)
})

test('create derives tenant/menu/position and preserves translations and course', async () => {
  const created = await mutate({ kind: 'create', selectedMenuId: menuA, body: { name: '  Drinks  ', description: 'cold', translations: { fr: { name: 'Boissons' }, pt: { name: 'Bebidas' } }, course: 'drink', position: 700, menu_id: menuA } }) as Category
  assert.equal(created.tenant_id, a)
  assert.equal(created.menu_id, menuA)
  assert.equal(created.position, 2)
  assert.equal(created.name, 'Drinks')
  assert.deepEqual(created.translations, { fr: { name: 'Boissons' } })
  assert.equal(created.course, 'drink')
  await assert.rejects(mutate({ kind: 'create', selectedMenuId: menuA, body: { name: 'Forged', tenant_id: b } }), { status: 400 })
  await assert.rejects(mutate({ kind: 'create', body: { name: 'Wrong menu', menu_id: foreignMenu } }), { status: 400 })
})

test('patch is tenant scoped, allows current fields and rejects ownership changes', async () => {
  const created = await mutate({ kind: 'create', selectedMenuId: menuB, body: { name: 'Dessert', course: null } }) as Category
  const changed = await mutate({ kind: 'patch', id: created.id, body: { name: 'Cake', is_active: false, course: 'dessert', position: 4 } }) as Category
  assert.equal(changed.id, created.id)
  assert.equal(changed.menu_id, menuB)
  assert.equal(changed.name, 'Cake')
  assert.equal(changed.position, 4)
  assert.equal(changed.is_active, false)
  await assert.rejects(mutate({ kind: 'patch', id: created.id, body: { menu_id: menuA } }), { status: 400 })
  await assert.rejects(mutate({ kind: 'patch', id: foreignMenu, body: { name: 'No' } }), { status: 404 })
  await assert.rejects(mutate({ kind: 'patch', id: created.id, body: { name: 'No' } }, 'store-staff'), { status: 403 })
})

test('delete preserves FK SET NULL effects only for same-tenant product/event references', async () => {
  const category = await mutate({ kind: 'create', selectedMenuId: menuA, body: { name: 'Removable' } }) as Category
  const productId = randomUUID(), eventId = randomUUID()
  await admin.query("INSERT INTO public.products(id,tenant_id,menu_id,category_id,name,price) VALUES($1,$2,$3,$4,'Dish',5)", [productId, a, menuA, category.id])
  await admin.query('INSERT INTO public.menu_events(id,tenant_id,category_id) VALUES($1,$2,$3)', [eventId, a, category.id])
  assert.deepEqual(await mutate({ kind: 'delete', id: category.id }), { ok: true })
  assert.equal((await admin.query('SELECT category_id FROM public.products WHERE id=$1', [productId])).rows[0].category_id, null)
  assert.equal((await admin.query('SELECT category_id FROM public.menu_events WHERE id=$1', [eventId])).rows[0].category_id, null)
  const guarded = await mutate({ kind: 'create', selectedMenuId: menuA, body: { name: 'Guarded' } }) as Category
  await admin.query('INSERT INTO public.menu_events(id,tenant_id,category_id) VALUES($1,$2,$3)', [randomUUID(), b, guarded.id])
  await assert.rejects(mutate({ kind: 'delete', id: guarded.id }), { status: 409 })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.categories WHERE id=$1', [guarded.id])).rows[0].n, 1)
})

test('staff, unknown category dependents and invalid selection fail closed', async () => {
  const created = await mutate({ kind: 'create', selectedMenuId: menuA, body: { name: 'Protected' } }) as Category
  await assert.rejects(mutate({ kind: 'create', body: { name: 'No' } }, 'store-staff'), { status: 403 })
  await assert.rejects(mutate({ kind: 'delete', id: created.id }, 'store-staff'), { status: 403 })
  await admin.query('CREATE TABLE public.unreviewed_category_child(id uuid PRIMARY KEY, category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE)')
  try {
    await assert.rejects(mutate({ kind: 'delete', id: created.id }), { status: 409 })
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.categories WHERE id=$1', [created.id])).rows[0].n, 1)
  } finally { await admin.query('DROP TABLE public.unreviewed_category_child') }
  assert.deepEqual((await list('not-a-menu')).menu?.id, menuA)
})
