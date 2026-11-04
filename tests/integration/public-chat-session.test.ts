// Explicit disposable CI database only; no Source/Auth/provider calls.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPublicChatSession } from '../../src/lib/data/public-chat-session'
import { hashPhone } from '../../src/lib/crypto'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable chat target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable chat target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tenant = randomUUID(), foreign = randomUUID(), plan = randomUUID(), phone = '+1 (202) 555-0101'
const run = (value: unknown = phone, slug = 'restaurant') => adminMenuTransaction(pool, true, query => createPublicChatSession(query, slug, value))
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.chat_conversations,public.chat_blocked_phones,public.chat_addon_settings,public.tenant_subscriptions,public.plans,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text UNIQUE,is_active boolean);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,chat_addon_available boolean);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),chat_addon_active boolean,chat_addon_override boolean);
    CREATE TABLE public.chat_addon_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),enabled boolean,rate_limit_per_phone_per_day integer CHECK(rate_limit_per_phone_per_day BETWEEN 1 AND 500));
    CREATE TABLE public.chat_blocked_phones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES public.tenants(id),phone_hash text,UNIQUE(tenant_id,phone_hash));
    CREATE TABLE public.chat_conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),phone_hash text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),last_message_at timestamptz NOT NULL DEFAULT now(),message_count int NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','blocked')))`)
  await admin.query("INSERT INTO public.tenants VALUES($1,'restaurant',true),($2,'foreign',true)", [tenant, foreign])
  await admin.query('INSERT INTO public.plans VALUES($1,true)', [plan])
  await admin.query('INSERT INTO public.tenant_subscriptions VALUES($1,$3,true,NULL),($2,$3,true,NULL)', [tenant, foreign, plan])
  await admin.query('INSERT INTO public.chat_addon_settings VALUES($1,true,20),($2,true,30)', [tenant, foreign])
})
after(async () => { await pool.end(); await admin.end() })
test('concurrent normalized first use creates one conversation and persists only the scoped hash', async () => {
  const result = await Promise.all([run(), run('12025550101')])
  assert.equal(result[0].conversation_id, result[1].conversation_id)
  const rows = (await admin.query('SELECT * FROM public.chat_conversations WHERE tenant_id=$1', [tenant])).rows
  assert.equal(rows.length, 1); assert.equal(rows[0].phone_hash, hashPhone('12025550101', tenant)); assert.equal(rows[0].message_count, 0)
})
test('same phone under another tenant never reuses a conversation or its hash', async () => {
  const a = await run(), b = await run(phone, 'foreign')
  assert.notEqual(a.conversation_id, b.conversation_id); assert.equal(b.rate_limit, 30)
  const row = (await admin.query('SELECT phone_hash FROM public.chat_conversations WHERE id=$1', [b.conversation_id])).rows[0]
  assert.equal(row.phone_hash, hashPhone('12025550101', foreign)); assert.notEqual(row.phone_hash, hashPhone('12025550101', tenant))
})
test('same UTC-day reuse returns stored count; a previous-day row starts a new conversation', async () => {
  const old = await run(); await admin.query('UPDATE public.chat_conversations SET message_count=8 WHERE id=$1', [old.conversation_id])
  assert.equal((await run()).messages_today, 8)
  await admin.query("UPDATE public.chat_conversations SET started_at=now()-interval '2 days' WHERE id=$1", [old.conversation_id])
  const next = await run(); assert.notEqual(next.conversation_id, old.conversation_id); assert.equal(next.messages_today, 0)
})
test('blocklist, active tenant and addon switches deny before conversation creation', async () => {
  const count = (await admin.query('SELECT count(*)::int AS n FROM public.chat_conversations')).rows[0].n
  const blocked = '12025550102', hashed = hashPhone(blocked, tenant)
  await admin.query('INSERT INTO public.chat_blocked_phones(tenant_id,phone_hash) VALUES($1,$2)', [tenant, hashed])
  await assert.rejects(run(blocked), { status: 403 })
  await admin.query('UPDATE public.tenants SET is_active=false WHERE id=$1', [tenant])
  try { await assert.rejects(run(), { status: 404 }) } finally { await admin.query('UPDATE public.tenants SET is_active=true WHERE id=$1', [tenant]) }
  await admin.query('UPDATE public.chat_addon_settings SET enabled=false WHERE tenant_id=$1', [tenant])
  try { await assert.rejects(run(), { status: 403 }) } finally { await admin.query('UPDATE public.chat_addon_settings SET enabled=true WHERE tenant_id=$1', [tenant]) }
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.chat_conversations')).rows[0].n, count)
})
test('explicit addon overrides retain force-on/force-off semantics', async () => {
  try {
    await admin.query('UPDATE public.plans SET chat_addon_available=false'); await assert.rejects(run(), { status: 403 })
    await admin.query('UPDATE public.tenant_subscriptions SET chat_addon_active=false,chat_addon_override=true WHERE tenant_id=$1', [tenant]); assert.ok((await run()).conversation_id)
    await admin.query('UPDATE public.tenant_subscriptions SET chat_addon_override=false WHERE tenant_id=$1', [tenant]); await assert.rejects(run(), { status: 403 })
  } finally { await admin.query('UPDATE public.plans SET chat_addon_available=true'); await admin.query('UPDATE public.tenant_subscriptions SET chat_addon_active=true,chat_addon_override=NULL WHERE tenant_id=$1', [tenant]) }
})
test('failed insertion rolls back and never returns an invented conversation', async () => {
  const count = (await admin.query('SELECT count(*)::int AS n FROM public.chat_conversations')).rows[0].n
  await admin.query('ALTER TABLE public.chat_conversations ADD CONSTRAINT fixture_refuse_chat CHECK(false) NOT VALID')
  try { await assert.rejects(run('12025550103'), { status: 503 }) } finally { await admin.query('ALTER TABLE public.chat_conversations DROP CONSTRAINT fixture_refuse_chat') }
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.chat_conversations')).rows[0].n, count)
})
