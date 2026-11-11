// Disposable CI database only. It creates and drops its OWN database, so the
// shared fixtures of the other integration files are never touched.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { sharedRuntimePool, closeSharedRuntimePools, SHARED_POOL_MAX } from '../../src/lib/data/shared-pool'
import { adminMenuTransaction } from '../../src/lib/data/admin-menus-runtime'
import type { AdminMenuQuery } from '../../src/lib/data/admin-menus'
import { parsePlatformSettingsPatch, readPlatformSettingsRow, writePlatformSettingsRow } from '../../src/lib/data/platform-settings'
import { readCustomDomainTenantSlug, readHostTenantSlug } from '../../src/lib/data/tenant-domain'
import { readOgTenant, readPlatformBlogSitemap, readSeoTenant, readSitemapTenants, readTenantSitemapEntries } from '../../src/lib/data/public-seo'
import { readTenantProductPicker } from '../../src/lib/data/superadmin-reads'
import { checkOwnedDatabase } from '../../src/lib/data/database-health'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw new Error('Explicit disposable CI target required')
const base = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.pathname !== '/xmartmenu_identity_test' || base.search || base.hash) {
  throw new Error('Not an isolated remaining-reads test target')
}
const DATABASE = 'xmartmenu_remaining_reads_test'
const target = new URL(raw); target.pathname = `/${DATABASE}`
const server = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 5_000 })
// pg-pool resolves end() before the sockets have closed; an unhandled 'error' from a
// connection that DROP DATABASE ... FORCE then terminates would be an uncaught exception.
server.on('error', () => {})
let admin: pg.Pool
const env = { NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: DATABASE,
  ADMIN_MENUS_DATABASE_URL: target.href, ADMIN_MENUS_DATABASE_SSL: 'disable',
  ORDERS_DATABASE_URL: target.href, ORDERS_DATABASE_SSL: 'disable' }
const tenantId = randomUUID(), otherTenantId = randomUUID(), menuId = randomUUID()

before(async () => {
  await server.query(`DROP DATABASE IF EXISTS ${DATABASE}`)
  await server.query(`CREATE DATABASE ${DATABASE}`)
  admin = new pg.Pool({ connectionString: target.href, max: 1, connectionTimeoutMillis: 5_000 })
  admin.on('error', () => {})
  const original = await readFile(new URL('../../supabase/migrations/004_platform_settings.sql', import.meta.url), 'utf8')
  await admin.query(original.slice(original.indexOf('CREATE TABLE'), original.indexOf('-- Insert English-first')))
  for (const file of ['045_platform_settings_columns.sql', '047_platform_favicon.sql', '057_platform_legal.sql']) {
    await admin.query(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  await admin.query(`ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS twitter_handle TEXT,
    ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await admin.query(`
    CREATE TABLE public.plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.tenants (id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, is_active boolean NOT NULL DEFAULT true,
      custom_domain text, custom_domain_verified boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.tenant_settings (tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id), primary_color text, accent_color text, tagline text, logo_url text);
    CREATE TABLE public.menus (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id), slug text NOT NULL, is_default boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true, position int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.locations (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id), slug text NOT NULL, is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, menu_id uuid NOT NULL, name text NOT NULL,
      image_url text, category_id uuid, position int NOT NULL DEFAULT 0);
    CREATE TABLE public.blog_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, slug text NOT NULL, status text NOT NULL, tags text,
      published_at timestamptz, updated_at timestamptz DEFAULT now());`)
  await admin.query(`INSERT INTO public.tenants(id,name,slug,custom_domain,custom_domain_verified) VALUES
    ($1,'Bistro','bistro','menu.bistro.test',true),($2,'Other','other','pending.other.test',false)`, [tenantId, otherTenantId])
  await admin.query(`INSERT INTO public.tenant_settings VALUES ($1,'#112233',NULL,'Good food',NULL)`, [tenantId])
  await admin.query(`INSERT INTO public.menus(id,tenant_id,slug,is_default,position) VALUES ($1,$2,'main',true,0),($3,$2,'lunch',false,1)`, [menuId, tenantId, randomUUID()])
  await admin.query(`INSERT INTO public.locations(id,tenant_id,slug) VALUES ($1,$2,'downtown')`, [randomUUID(), tenantId])
  await admin.query(`INSERT INTO public.products(tenant_id,menu_id,name,position) VALUES ($1,$2,'B',2),($1,$2,'A',1),($3,$2,'foreign',0)`, [tenantId, menuId, otherTenantId])
  await admin.query(`INSERT INTO public.blog_posts(tenant_id,slug,status,tags,published_at) VALUES
    (NULL,'live','published','Massa Fresca',now() - interval '2 days'),(NULL,'draft','draft','x',NULL),($1,'tenant-post','published','y',now() - interval '1 day')`, [tenantId])
})
after(async () => {
  await closeSharedRuntimePools()
  await admin?.end()
  // Wait for the server to see the sessions gone instead of racing them with FORCE.
  for (let attempt = 0; attempt < 40; attempt++) {
    const open = await server.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [DATABASE])
    if (open.rows[0].n === 0) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await server.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`)
  await server.end()
})

test('every prefix pointing at one database shares a single bounded pool', async () => {
  const a = sharedRuntimePool('ADMIN_MENUS', env), b = sharedRuntimePool('ORDERS', env)
  assert.equal(a, b)
  // Far more concurrent work than the cap: the database must never see more than SHARED_POOL_MAX sessions.
  const seen = new Set<number>()
  await Promise.all(Array.from({ length: SHARED_POOL_MAX * 4 }, async () => {
    const result = await a.query('SELECT pg_backend_pid() AS pid, pg_sleep(0.05)')
    seen.add(result.rows[0].pid)
  }))
  assert.ok(seen.size <= SHARED_POOL_MAX, `used ${seen.size} connections`)
  const active = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND application_name='xmartmenu-runtime'`, [DATABASE])
  assert.ok(active.rows[0].n <= SHARED_POOL_MAX)
})

test('platform settings: projection, atomic update, insert when empty, jsonb stored as an object', async () => {
  const pool = sharedRuntimePool('ADMIN_MENUS', env)
  const run = <T>(write: boolean, op: (query: AdminMenuQuery) => Promise<T>) => adminMenuTransaction(pool, write, op)
  await admin.query('DELETE FROM public.platform_settings')
  assert.equal(await run(false, q => readPlatformSettingsRow(q, ['cta_color'])), null)
  const created = await run(true, q => writePlatformSettingsRow(q, parsePlatformSettingsPatch({ app_name: 'Created', landing: { hero: 'x' } })))
  assert.equal(created.app_name, 'Created')
  const updated = await run(true, q => writePlatformSettingsRow(q, parsePlatformSettingsPatch({ cta_color: '#abcdef', legal: { terms: { title: 'T', body: 'B' } } })))
  assert.equal(updated.id, created.id)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.platform_settings')).rows[0].n, 1)
  const projected = await run(false, q => readPlatformSettingsRow(q, ['cta_color', 'app_name']))
  assert.deepEqual(projected, { app_name: 'Created', cta_color: '#abcdef' })
  const stored = (await admin.query(`SELECT jsonb_typeof(landing) AS landing, jsonb_typeof(legal) AS legal FROM public.platform_settings`)).rows[0]
  assert.deepEqual(stored, { landing: 'object', legal: 'object' })
  const whole = await run(false, q => readPlatformSettingsRow(q, '*'))
  assert.deepEqual(whole?.legal, { terms: { title: 'T', body: 'B' } })
})

test('platform settings writes are serialized and the read-only transaction cannot write', async () => {
  const pool = sharedRuntimePool('ADMIN_MENUS', env)
  await Promise.all(['A', 'B', 'C', 'D'].map(name => adminMenuTransaction(pool, true, q => writePlatformSettingsRow(q, { app_name: name }))))
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.platform_settings')).rows[0].n, 1)
  await assert.rejects(adminMenuTransaction(pool, false, q => q("UPDATE public.platform_settings SET app_name='nope'")))
})

test('custom domain lookup only matches an active, verified, unique tenant', async () => {
  const pool = sharedRuntimePool('ADMIN_MENUS', env)
  const lookup = (host: string) => adminMenuTransaction(pool, false, q => readCustomDomainTenantSlug(q, host))
  assert.equal(await lookup('MENU.bistro.test'), 'bistro')
  assert.equal(await lookup('pending.other.test'), null)
  assert.equal(await lookup('unknown.test'), null)
  await admin.query('UPDATE public.tenants SET is_active=false WHERE id=$1', [tenantId])
  assert.equal(await lookup('menu.bistro.test'), null)
  await admin.query('UPDATE public.tenants SET is_active=true WHERE id=$1', [tenantId])
})

test('restaurant subdomains resolve only after the schema step, by label, for an active tenant', async () => {
  const pool = sharedRuntimePool('ADMIN_MENUS', env)
  const base = 'menus.example.test'
  const lookup = (host: string) => adminMenuTransaction(pool, false, q => readHostTenantSlug(q, host, base))
  // Before the column exists: no subdomain answers, custom domains still do, SEO reads still work.
  assert.equal(await lookup('bistro.menus.example.test'), null)
  assert.equal(await lookup('MENU.bistro.test'), 'bistro')
  assert.equal((await adminMenuTransaction(pool, false, q => readSeoTenant(q, 'bistro')))?.subdomain, null)
  await admin.query(await readFile(new URL('../../supabase/migrations/20261111140000_tenant_subdomain.sql', import.meta.url), 'utf8'))
  await admin.query("UPDATE public.tenants SET subdomain='bistro' WHERE id=$1", [tenantId])
  assert.equal(await lookup('Bistro.Menus.Example.Test:443'), 'bistro')
  assert.equal(await lookup('other.menus.example.test'), null)
  assert.equal(await lookup('a.bistro.menus.example.test'), null) // one level only
  assert.equal(await lookup('menus.example.test'), null)
  assert.equal(await adminMenuTransaction(pool, false, q => readHostTenantSlug(q, 'bistro.menus.example.test', null)), null) // feature off
  assert.equal((await adminMenuTransaction(pool, false, q => readSeoTenant(q, 'bistro')))?.subdomain, 'bistro')
  assert.equal((await adminMenuTransaction(pool, false, readSitemapTenants)).find(t => t.slug === 'bistro')?.subdomain, 'bistro')
  await assert.rejects(admin.query("UPDATE public.tenants SET subdomain='bistro' WHERE slug='other'"), { code: '23505' })
  await assert.rejects(admin.query("UPDATE public.tenants SET subdomain='Not_A_Label' WHERE slug='other'"), { code: '23514' })
  await admin.query('UPDATE public.tenants SET is_active=false WHERE id=$1', [tenantId])
  assert.equal(await lookup('bistro.menus.example.test'), null)
  await admin.query('UPDATE public.tenants SET is_active=true, subdomain=NULL WHERE id=$1', [tenantId])
})

test('SEO and picker reads keep the legacy projections and tenant boundaries', async () => {
  const pool = sharedRuntimePool('ADMIN_MENUS', env)
  const run = <T>(op: (query: AdminMenuQuery) => Promise<T>) => adminMenuTransaction(pool, false, op)
  const tenants = await run(readSitemapTenants)
  assert.deepEqual(tenants.map(t => t.slug).sort(), ['bistro', 'other'])
  assert.equal(tenants.find(t => t.slug === 'bistro')?.custom_domain_verified, true)
  const seo = await run(q => readSeoTenant(q, 'bistro'))
  assert.equal(seo?.id, tenantId)
  assert.equal(await run(q => readSeoTenant(q, 'missing')), null)
  const entries = await run(q => readTenantSitemapEntries(q, tenantId))
  assert.deepEqual(entries.menus.map(m => m.slug), ['main', 'lunch'])
  assert.deepEqual(entries.locations.map(l => l.slug), ['downtown'])
  const og = await run(q => readOgTenant(q, 'bistro'))
  assert.equal(og?.settings.tagline, 'Good food')
  const blog = await run(q => readPlatformBlogSitemap(q))
  assert.deepEqual(blog.posts.map(p => p.slug), ['live'])
  assert.deepEqual(blog.tags, ['massa-fresca'])
  const picker = await run(q => readTenantProductPicker(q, tenantId, menuId))
  assert.deepEqual(picker.map(p => p.name), ['A', 'B'])
})

test('owned readiness reports ok, then a sanitized failure when the table is gone', async () => {
  const pool = sharedRuntimePool('ADMIN_MENUS', env)
  const probe = () => checkOwnedDatabase(operation => adminMenuTransaction(pool, false, operation, 3000))
  assert.equal((await probe()).ok, true)
  await admin.query('ALTER TABLE public.plans RENAME TO plans_gone')
  const down = await probe()
  assert.equal(down.ok, false)
  assert.equal(down.error, 'database unavailable')
  await admin.query('ALTER TABLE public.plans_gone RENAME TO plans')
})

test('a connection terminated while checked out neither crashes the process nor poisons the pool', async () => {
  const pool = sharedRuntimePool('ADMIN_MENUS', env)
  const uncaught: unknown[] = []
  const record = (error: unknown) => { uncaught.push(error) }
  process.on('uncaughtException', record)
  try {
    const client = await pool.connect()
    await client.query('BEGIN')
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await admin.query('SELECT pg_terminate_backend($1)', [pid])
    await new Promise(resolve => setTimeout(resolve, 300))
    await assert.rejects(client.query('SELECT 1'))
    client.release(true)
    assert.equal((await pool.query('SELECT 1 AS ok')).rows[0].ok, 1)
  } finally { process.off('uncaughtException', record) }
  assert.deepEqual(uncaught, [])
})
