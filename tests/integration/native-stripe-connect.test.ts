// Explicit disposable CI database. No Stripe/OAuth/Auth/QStash calls.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
import { claimNativeStripeOAuth, completeNativeStripeOAuth, refuseNativeStripeOAuth, connectNativeStripe, disconnectNativeStripe, readNativeStripeAvailability, readNativeStripeConnection, readNativeStripeCurrency, readNativeStripeOwnerState } from '../../src/lib/data/stripe-connect'
import type { AdminActorContext } from '../../src/lib/data/admin-actor'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable Connect target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable Connect target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tx = <T>(op: Parameters<typeof adminMenuTransaction<T>>[2]) => adminMenuTransaction(pool, true, op)
const a = randomUUID(), b = randomUUID(), ownerA = randomUUID(), ownerB = randomUUID(), staff = randomUUID(), superadmin = randomUUID(), plan = randomUUID()
const owner: AdminActorContext = { actorId: ownerA, role: 'store-admin', tenantId: a }, now = new Date('2026-11-04T22:00:00Z')
const proof = () => ({ nonceHash: randomBytes(32).toString('hex'), codeHash: randomBytes(32).toString('hex'), expiresAt: now.getTime() + 60000 })
const connection = (id = a) => tx(query => readNativeStripeConnection(query, id))
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.app_stripe_oauth_attempts,public.stripe_connections,public.tenant_settings,public.tenant_subscriptions,public.plans,public.profiles,public.app_accounts,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),role text,must_change_password boolean);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,name text,slug text,description text,monthly_price numeric,annual_price numeric,transaction_fee_pct numeric,features jsonb);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),billing_cycle text,status text,override_monthly_price numeric,override_annual_price numeric,override_transaction_fee_pct numeric,override_notes text);
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),currency text);
    CREATE TABLE public.stripe_connections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES public.tenants(id),stripe_account_id text NOT NULL,scope text NOT NULL DEFAULT 'read_write',is_active boolean NOT NULL DEFAULT true,connected_at timestamptz DEFAULT now(),disconnected_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`)
  const proposal = await readFile(new URL('../../docs/proposals/native-stripe-oauth-owned-only.sql', import.meta.url), 'utf8')
  await admin.query(proposal.slice(proposal.indexOf('CREATE TABLE public.app_stripe_oauth_attempts'), proposal.indexOf('REVOKE ALL ON')))
  await admin.query('INSERT INTO public.tenants VALUES($1),($2)', [a, b])
  await admin.query("INSERT INTO public.profiles VALUES($1,$5,'store-admin',false),($2,$6,'store-admin',false),($3,$5,'store-staff',false),($4,NULL,'superadmin',false)", [ownerA, ownerB, staff, superadmin, a, b])
  await admin.query('INSERT INTO public.app_accounts VALUES($1,NULL),($2,NULL),($3,NULL),($4,NULL)', [ownerA, ownerB, staff, superadmin])
  await admin.query("INSERT INTO public.plans VALUES($1,'Payments','payments',NULL,30,300,3,$2)", [plan, JSON.stringify(['payments','stripe-connect'])])
  await admin.query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$3,'monthly','active'),($2,$3,'monthly','active')", [a, b, plan])
  await admin.query("INSERT INTO public.tenant_settings VALUES($1,'BRL'),($2,NULL)", [a, b])
})
beforeEach(async () => {
  await admin.query('DELETE FROM public.app_stripe_oauth_attempts; UPDATE public.app_accounts SET disabled_at=NULL; UPDATE public.profiles SET must_change_password=false; UPDATE public.tenant_subscriptions SET status=\'active\'; DELETE FROM public.stripe_connections')
  await admin.query("UPDATE public.profiles SET role=CASE WHEN id=$1 THEN 'store-staff' WHEN id=$2 THEN 'superadmin' ELSE 'store-admin' END", [staff, superadmin])
  await admin.query("INSERT INTO public.stripe_connections(tenant_id,stripe_account_id) VALUES($1,'acct_tenanta'),($2,'acct_tenantb')", [a, b])
})
after(async () => {
  await pool.end()
  try { await admin.query('DROP TABLE IF EXISTS public.app_stripe_oauth_attempts,public.stripe_connections,public.tenant_settings,public.tenant_subscriptions,public.plans,public.profiles,public.app_accounts,public.tenants CASCADE') }
  finally { await admin.end() }
})
test('active connection/plan/currency readers retain tenant scope, canonical currencies and nullable lifecycle facts', async () => {
  assert.equal((await connection())?.stripe_account_id, 'acct_tenanta'); assert.equal((await connection(b))?.stripe_account_id, 'acct_tenantb')
  assert.equal(await tx(query => readNativeStripeCurrency(query, a)), 'brl'); assert.equal(await tx(query => readNativeStripeCurrency(query, b)), 'usd')
  assert.equal((await tx(query => readNativeStripeAvailability(query, a))).feature, true)
  await admin.query('UPDATE public.stripe_connections SET is_active=false WHERE tenant_id=$1', [a]); assert.equal(await connection(), null)
  await admin.query("UPDATE public.tenant_subscriptions SET status='cancelled' WHERE tenant_id=$1", [b]); assert.deepEqual(await tx(query => readNativeStripeAvailability(query, b)), { feature: false, connection: null })
})
test('owner/staff/foreign-tenant and current disabled/reset/role controls govern every mutation', async () => {
  for (const invalid of [{ ...owner, actorId: staff }, { ...owner, tenantId: b }, { ...owner, role: 'store-staff' as const }]) {
    await assert.rejects(tx(query => connectNativeStripe(query, invalid, 'acct_new', now)), { status: 403 })
  }
  await admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1', [ownerA])
  await assert.rejects(tx(query => readNativeStripeOwnerState(query, owner)), { status: 403 })
  await admin.query('UPDATE public.app_accounts SET disabled_at=NULL WHERE id=$1', [ownerA]); await admin.query('UPDATE public.profiles SET must_change_password=true WHERE id=$1', [ownerA])
  await assert.rejects(tx(query => disconnectNativeStripe(query, owner, now)), { status: 403 })
  assert.equal((await connection())?.stripe_account_id, 'acct_tenanta')
})
test('callback persistence rechecks live plan and owner while superadmin can explicitly preview a tenant', async () => {
  await admin.query("UPDATE public.tenant_subscriptions SET status='cancelled' WHERE tenant_id=$1", [a])
  await assert.rejects(tx(query => connectNativeStripe(query, owner, 'acct_new', now)), { status: 403 })
  await admin.query("UPDATE public.tenant_subscriptions SET status='active' WHERE tenant_id=$1", [a])
  await admin.query("UPDATE public.profiles SET role='store-staff' WHERE id=$1", [ownerA])
  await assert.rejects(tx(query => connectNativeStripe(query, owner, 'acct_new', now)), { status: 403 })
  await tx(query => connectNativeStripe(query, { actorId: superadmin, role: 'superadmin', tenantId: a }, 'acct_superpreview', now))
  assert.equal((await connection())?.stripe_account_id, 'acct_superpreview'); assert.equal((await connection(b))?.stripe_account_id, 'acct_tenantb')
})
test('connect/reconnect writes only lifecycle fields and disconnect stays available after plan loss', async () => {
  const original = await connection()
  await tx(query => connectNativeStripe(query, owner, 'acct_reconnected', now))
  const updated = await connection(); assert.equal(updated?.id, original?.id); assert.equal(updated?.connected_at, now.toISOString()); assert.equal(updated?.disconnected_at, null); assert.equal(updated?.scope, 'read_write')
  await admin.query("UPDATE public.tenant_subscriptions SET status='cancelled' WHERE tenant_id=$1", [a])
  assert.deepEqual(await tx(query => disconnectNativeStripe(query, owner, now)), { accountId: 'acct_reconnected' }); assert.equal(await connection(), null)
  assert.equal(await tx(query => disconnectNativeStripe(query, owner, now)), null)
  assert.equal((await connection(b))?.stripe_account_id, 'acct_tenantb')
})
test('same-account callbacks across tenants serialize and refuse ambiguous ownership instead of assigning twice', async () => {
  const results = await Promise.allSettled([tx(query => connectNativeStripe(query, owner, 'acct_shared', now)), tx(query => connectNativeStripe(query, { actorId: ownerB, role: 'store-admin', tenantId: b }, 'acct_shared', now))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && (result.reason as { status?: number }).status === 409).length, 1)
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.stripe_connections WHERE stripe_account_id='acct_shared'")).rows[0].n, 1)
})
test('database failures roll back connection changes without touching the other tenant', async () => {
  await admin.query("ALTER TABLE public.stripe_connections ADD CONSTRAINT fixture_refuse_account CHECK(stripe_account_id<>'acct_refused')")
  try {
    await assert.rejects(tx(query => connectNativeStripe(query, owner, 'acct_refused', now)), { status: 503 })
    assert.equal((await connection())?.stripe_account_id, 'acct_tenanta'); assert.equal((await connection(b))?.stripe_account_id, 'acct_tenantb')
  } finally { await admin.query('ALTER TABLE public.stripe_connections DROP CONSTRAINT fixture_refuse_account') }
})
test('single-use nonce/code claims serialize duplicate callbacks and never permit a second exchange', async () => {
  const value = proof()
  const results = await Promise.all([tx(query => claimNativeStripeOAuth(query, owner, value, now)), tx(query => claimNativeStripeOAuth(query, owner, value, now))])
  assert.deepEqual(results.sort(), ['claimed','refused'])
  assert.equal(await tx(query => claimNativeStripeOAuth(query, owner, { ...proof(), codeHash: value.codeHash }, now)), 'refused')
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_stripe_oauth_attempts')).rows[0].n, 1)
  await tx(query => refuseNativeStripeOAuth(query, owner, value))
  assert.equal(await tx(query => claimNativeStripeOAuth(query, owner, value, now)), 'refused')
})
test('connection and consumed callback receipt commit together; a completed duplicate never reconnects after disconnect', async () => {
  const value = proof()
  assert.equal(await tx(query => claimNativeStripeOAuth(query, owner, value, now)), 'claimed')
  await tx(query => completeNativeStripeOAuth(query, owner, value, 'acct_completed', now))
  assert.equal((await connection())?.stripe_account_id, 'acct_completed')
  assert.equal(await tx(query => claimNativeStripeOAuth(query, owner, value, now)), 'connected')
  await tx(query => disconnectNativeStripe(query, owner, now))
  assert.equal(await tx(query => claimNativeStripeOAuth(query, owner, value, now)), 'refused')
  assert.equal((await admin.query('SELECT state FROM public.app_stripe_oauth_attempts WHERE nonce_hash=$1', [value.nonceHash])).rows[0].state, 'connected')
})
test('post-provider SQL failure preserves the claim and permanently refuses replay rather than exchanging again', async () => {
  const value = proof()
  await tx(query => claimNativeStripeOAuth(query, owner, value, now))
  await admin.query("ALTER TABLE public.stripe_connections ADD CONSTRAINT fixture_claim_failure CHECK(stripe_account_id<>'acct_claimfailed')")
  try { await assert.rejects(tx(query => completeNativeStripeOAuth(query, owner, value, 'acct_claimfailed', now)), { status: 503 }) }
  finally { await admin.query('ALTER TABLE public.stripe_connections DROP CONSTRAINT fixture_claim_failure') }
  assert.equal((await connection())?.stripe_account_id, 'acct_tenanta')
  await tx(query => refuseNativeStripeOAuth(query, owner, value, 'acct_claimfailed'))
  assert.equal(await tx(query => claimNativeStripeOAuth(query, owner, value, now)), 'refused')
  const row = (await admin.query('SELECT * FROM public.app_stripe_oauth_attempts WHERE nonce_hash=$1', [value.nonceHash])).rows[0]
  assert.equal(row.state, 'reconcile_required'); assert.equal(row.stripe_account_id, 'acct_claimfailed'); assert.equal(row.completed_at, null)
  assert.equal('code' in row || 'access_token' in row || 'refresh_token' in row, false)
})
