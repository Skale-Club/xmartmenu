// Only the disposable, loopback CI database. No dotenv or live migrations.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { mutateAdminCustomDomain, mutateAdminServiceSettings, mutateAdminStoreSettings, readAdminStorePage } from '../../src/lib/data/admin-store-settings'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated admin store settings target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const activeTenant = randomUUID(), cancelledTenant = randomUUID(), paymentPlan = randomUUID(), menuPlan = randomUUID(), stripeConnectionId = randomUUID()
const active = { tenantId: activeTenant, role: 'store-admin' as const }
const cancelled = { tenantId: cancelledTenant, role: 'store-admin' as const }

before(async () => {
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  const initial = await readFile(new URL('001_initial_schema.sql', directory), 'utf8')
  const planMigration = await readFile(new URL('030_plans_subscriptions.sql', directory), 'utf8')
  await admin.query('DROP TABLE IF EXISTS public.tenant_settings, public.stripe_connections, public.tenant_subscriptions, public.plans, public.tenants CASCADE')
  for (const [table, source] of [['tenants', initial], ['tenant_settings', initial], ['plans', planMigration], ['tenant_subscriptions', planMigration], ['stripe_connections', planMigration]] as const) {
    const ddl = source.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\([\\s\\S]*?\\r?\\n\\);`, 'i'))?.[0]
    assert.ok(ddl, `Historical DDL missing: ${table}`)
    await admin.query(ddl)
  }
  await admin.query('ALTER TABLE public.tenants ADD COLUMN custom_domain TEXT UNIQUE, ADD COLUMN custom_domain_verified BOOLEAN NOT NULL DEFAULT false')

  const migrations = ['019_full_schema_sync.sql', '025_notes_and_realtime.sql', '026_ingredient_schema.sql', '027_kds_thresholds.sql', '034_order_types_tenant_settings.sql', '038_tip_system.sql', '043_tables_waiter.sql', '053_local_seo_address_geo.sql', '20261025140000_order_sequence_upsell.sql']
  for (const migration of migrations) {
    const source = await readFile(new URL(migration, directory), 'utf8')
    for (const statement of source.matchAll(/ALTER TABLE\s+(?:public\.)?tenant_settings[\s\S]*?;/gi)) {
      await admin.query(statement[0].replace(/ALTER TABLE\s+tenant_settings/i, 'ALTER TABLE public.tenant_settings'))
    }
  }

  await admin.query("INSERT INTO public.tenants(id,slug,name) VALUES($1,$2,'Active'),($3,$4,'Cancelled')", [activeTenant, `store-active-${activeTenant}`, cancelledTenant, `store-cancelled-${cancelledTenant}`])
  await admin.query("INSERT INTO public.plans(id,name,slug,monthly_price,annual_price,features) VALUES($1,'Payments','store-payments-fixture',0,0,'[\"orders\",\"payments\",\"stripe-connect\"]'::jsonb),($2,'Menu','store-menu-fixture',0,0,'[\"digital-menu\"]'::jsonb)", [paymentPlan, menuPlan])
  await admin.query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$3,'monthly','active'),($2,$4,'monthly','cancelled')", [activeTenant, cancelledTenant, paymentPlan, paymentPlan])
  await admin.query("INSERT INTO public.stripe_connections(id,tenant_id,stripe_account_id,scope,is_active) VALUES($1,$2,'acct_metadata_only','read_write',true)", [stripeConnectionId, activeTenant])
})

after(async () => { await pool.end(); await admin.end() })

test('owned Store page reads scoped settings and live plan capabilities without exposing unrelated columns', async () => {
  const activePage = await adminMenuTransaction(pool, false, query => readAdminStorePage(query, active))
  const cancelledPage = await adminMenuTransaction(pool, false, query => readAdminStorePage(query, cancelled))
  assert.equal(activePage.capabilities.plan.payments, true)
  assert.equal(activePage.capabilities.plan.stripe, true)
  assert.equal(cancelledPage.capabilities.plan.payments, false)
  assert.equal(activePage.tenant.custom_domain, null)
  assert.equal(activePage.stripeConnection?.stripe_account_id, 'acct_metadata_only')
  assert.equal(activePage.stripeConnection?.is_active, true)
  assert.ok(!('openrouter_api_key' in (activePage.settings ?? {})))
})

test('regional and service writes preserve payment gates, strict tenant scope, and domain verification reset', async () => {
  const saved = await adminMenuTransaction(pool, true, query => mutateAdminStoreSettings(query, active, {
    currency: ' CAD ', language: 'en', address: ' 22 King St ', city: 'Toronto', latitude: 43.65, longitude: -79.38,
    business_hours: { mon: '09:00-17:00' }, tip_percentage_1: 16,
  }))
  assert.equal(saved.settings.currency, 'CAD')
  assert.equal(saved.settings.address, '22 King St')
  assert.deepEqual(saved.settings.business_hours, { mon: '09:00-17:00' })
  assert.equal(saved.capabilities.plan.payments, true)
  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminStoreSettings(query, active, { tenant_id: cancelledTenant, currency: 'USD' })), { status: 400 })
  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminStoreSettings(query, cancelled, { tip_percentage_1: 17 })), { status: 403 })

  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminServiceSettings(query, cancelled, { direct_orders_enabled: true })), { status: 403 })
  const disabled = await adminMenuTransaction(pool, true, query => mutateAdminServiceSettings(query, cancelled, { direct_orders_enabled: false }))
  assert.equal(disabled.settings.direct_orders_enabled, false)
  const enabled = await adminMenuTransaction(pool, true, query => mutateAdminServiceSettings(query, active, { orders_enabled: true, direct_orders_enabled: true, whatsapp: '+1 (212) 555-0199' }))
  assert.equal(enabled.settings.whatsapp, '12125550199')

  await admin.query('UPDATE public.tenants SET custom_domain=$1,custom_domain_verified=true WHERE id=$2', ['shop.example.test', activeTenant])
  const domain = await adminMenuTransaction(pool, true, query => mutateAdminCustomDomain(query, active, activeTenant, ' SHOP.EXAMPLE.TEST '))
  assert.deepEqual(domain, { custom_domain: 'shop.example.test', custom_domain_verified: false })
  await assert.rejects(adminMenuTransaction(pool, true, query => mutateAdminCustomDomain(query, cancelled, cancelledTenant, 'shop.example.test')), { status: 409 })
})
