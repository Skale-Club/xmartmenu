// Only the disposable, loopback CI database. No dotenv or live migrations.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { mutateAdminDisplaySettings, readAdminMenuDisplayPage } from '../../src/lib/data/admin-display-settings'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated admin display settings target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const activeTenant = randomUUID(), cancelledTenant = randomUUID(), paymentPlan = randomUUID()
const activeContext = { tenantId: activeTenant, role: 'store-admin' as const }
const cancelledContext = { tenantId: cancelledTenant, role: 'store-admin' as const }

before(async () => {
  const tables: Array<[string, string]> = [
    ['tenants', '001_initial_schema.sql'],
    ['tenant_settings', '001_initial_schema.sql'],
    ['plans', '030_plans_subscriptions.sql'],
    ['tenant_subscriptions', '030_plans_subscriptions.sql'],
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
  const wantedSettings = new Set(['analytics_enabled', 'visual_feed_enabled', 'menu_default_view', 'feed_autoplay_videos', 'upsell_enabled'])
  for (const source of sources.values()) {
    for (const match of source.matchAll(/ALTER TABLE\s+(?:public\.)?tenant_settings\s+(ADD\s+COLUMN[\s\S]*?);/gi)) {
      const columns = [...match[1].matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)].map(item => item[1])
      if (columns.some(column => wantedSettings.has(column))) {
        await admin.query(match[0].replace(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi, 'ADD COLUMN IF NOT EXISTS '))
      }
    }
  }
  await admin.query('INSERT INTO public.tenants(id,slug,name) VALUES($1,$2,\'Active\'),($3,$4,\'Cancelled\')', [activeTenant, `active-${activeTenant}`, cancelledTenant, `cancelled-${cancelledTenant}`])
  await admin.query("INSERT INTO public.plans(id,name,slug,monthly_price,annual_price,features) VALUES($1,'Payments','payments-fixture',0,0,'[\"payments\"]'::jsonb)", [paymentPlan])
  await admin.query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$3,'monthly','active'),($2,$3,'monthly','cancelled')", [activeTenant, cancelledTenant, paymentPlan])
})

after(async () => { await pool.end(); await admin.end() })

test('owned menu display reads plan eligibility and checks locked upsell inside the write transaction', async () => {
  const active = await adminMenuTransaction(pool, false, query => readAdminMenuDisplayPage(query, activeContext))
  const cancelled = await adminMenuTransaction(pool, false, query => readAdminMenuDisplayPage(query, cancelledContext))
  assert.equal(active.upsellAvailable, true)
  assert.equal(cancelled.upsellAvailable, false)

  const saved = await adminMenuTransaction(pool, true, query => mutateAdminDisplaySettings(query, activeContext, 'menu-display', { upsell_enabled: true }))
  assert.equal(saved.upsell_enabled, true)
  await assert.rejects(
    adminMenuTransaction(pool, true, query => mutateAdminDisplaySettings(query, cancelledContext, 'menu-display', { upsell_enabled: true })),
    { status: 403 },
  )
  assert.equal((await admin.query('SELECT upsell_enabled FROM public.tenant_settings WHERE tenant_id=$1', [cancelledTenant])).rows.length, 0)
})
