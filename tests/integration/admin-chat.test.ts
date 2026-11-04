// Disposable loopback CI target only. No Source/Auth/provider/production calls.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { blockAdminChatPhone, readAdminChatBlocked, readAdminChatConversations, readAdminChatSettings, readAdminChatThread, unblockAdminChatPhone, writeAdminChatNote, writeAdminChatSettings, type AdminChatContext } from '../../src/lib/data/admin-chat'
import { savePublicChatTurn } from '../../src/lib/data/public-chat-turns'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable admin chat target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable admin chat target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), actor = randomUUID(), staff = randomUUID(), superadmin = randomUUID(), plan = randomUUID(), conversation = randomUUID(), second = randomUUID(), foreign = randomUUID(), hash = 'tenant-scoped-anonymous-fixture', legacyCiphertext = randomUUID()
const context: AdminChatContext = { tenantId: a, actorId: actor, role: 'store-admin' }
const run = <T>(write: boolean, operation: (query: Parameters<typeof readAdminChatSettings>[0]) => Promise<T>) => adminMenuTransaction(pool, write, operation)
const block = () => run(true, query => blockAdminChatPhone(query, context, conversation, { reason: 'spam' }))
const save = () => run(true, query => savePublicChatTurn(query, { slug: 'restaurant', tenantId: a, conversationId: second, user: 'Question', assistant: 'Answer', tokens: 12, voiceVerified: false }))
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.chat_messages,public.chat_conversations,public.chat_blocked_phones,public.chat_addon_settings,public.tenant_subscriptions,public.plans,public.profiles,public.app_accounts,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text,name text,is_active boolean);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES public.app_accounts(id),role text,tenant_id uuid REFERENCES public.tenants(id),must_change_password boolean);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,chat_addon_available boolean);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),chat_addon_active boolean,chat_addon_override boolean);
    CREATE TABLE public.chat_addon_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),enabled boolean NOT NULL DEFAULT false,openrouter_model text DEFAULT 'openai/gpt-4o-mini',audio_enabled boolean DEFAULT false,text_enabled boolean DEFAULT true,audio_provider text,rate_limit_per_phone_per_day int DEFAULT 30 CHECK(rate_limit_per_phone_per_day BETWEEN 1 AND 500),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),openrouter_api_key text,audio_api_key text);
    CREATE TABLE public.chat_conversations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),phone_hash text,started_at timestamptz DEFAULT now(),last_message_at timestamptz DEFAULT now(),message_count int DEFAULT 0,status text DEFAULT 'active',admin_note text);
    CREATE TABLE public.chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES public.chat_conversations(id),role text CHECK(role IN('user','assistant')),content text,created_at timestamptz DEFAULT now(),has_audio boolean DEFAULT false,tokens_used int);
    CREATE TABLE public.chat_blocked_phones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES public.tenants(id),phone_hash text,blocked_by uuid REFERENCES public.profiles(id),reason text,blocked_at timestamptz DEFAULT now(),UNIQUE(tenant_id,phone_hash))`)
  await admin.query("INSERT INTO public.tenants VALUES($1,'restaurant','Restaurant',true),($2,'foreign','Foreign',true)", [a, b])
  await admin.query('INSERT INTO public.app_accounts VALUES($1,NULL),($2,NULL),($3,NULL)', [actor, staff, superadmin])
  await admin.query("INSERT INTO public.profiles VALUES($1,'store-admin',$4,false),($2,'store-staff',$4,false),($3,'superadmin',NULL,false)", [actor, staff, superadmin, a])
  await admin.query('INSERT INTO public.plans VALUES($1,true)', [plan]); await admin.query('INSERT INTO public.tenant_subscriptions VALUES($1,$3,true,NULL),($2,$3,true,NULL)', [a, b, plan])
  await admin.query('INSERT INTO public.chat_addon_settings(tenant_id,enabled,text_enabled,audio_enabled,rate_limit_per_phone_per_day,openrouter_api_key,audio_api_key) VALUES($1,true,true,true,20,$3,$3),($2,true,true,true,20,$3,$3)', [a, b, legacyCiphertext])
  await admin.query('INSERT INTO public.chat_conversations(id,tenant_id,phone_hash) VALUES($1,$2,$3),($4,$2,$3),($5,$6,$3)', [conversation, a, hash, second, foreign, b])
})
beforeEach(async () => {
  await admin.query('DELETE FROM public.chat_messages'); await admin.query('DELETE FROM public.chat_blocked_phones')
  await admin.query("UPDATE public.chat_conversations SET status='active',message_count=0,admin_note=NULL")
  await admin.query('UPDATE public.app_accounts SET disabled_at=NULL'); await admin.query("UPDATE public.profiles SET role='store-admin',tenant_id=$2,must_change_password=false WHERE id=$1", [actor, a])
  await admin.query('UPDATE public.chat_addon_settings SET enabled=true,text_enabled=true,audio_enabled=true,rate_limit_per_phone_per_day=20')
})
after(async () => { await pool.end(); await admin.end() })
test('settings projections omit both keys and whitelist upserts preserve credentials/tenant scope and clamp limits', async () => {
  const before = await run(false, query => readAdminChatSettings(query, context))
  assert.equal(before.status.enabled, true); assert.ok(before.settings); assert.equal('openrouter_api_key' in before.settings, false); assert.equal('audio_api_key' in before.settings, false)
  await run(true, query => writeAdminChatSettings(query, context, { enabled: false, text_enabled: false, rate_limit_per_phone_per_day: 999.5, tenant_id: b, openrouter_api_key: 'ignored', audio_api_key: 'ignored' }))
  const rows = (await admin.query('SELECT * FROM public.chat_addon_settings')).rows, local = rows.find(row => row.tenant_id === a), other = rows.find(row => row.tenant_id === b)
  assert.equal(local.enabled, false); assert.equal(local.text_enabled, false); assert.equal(local.rate_limit_per_phone_per_day, 500); assert.equal(local.openrouter_api_key, legacyCiphertext); assert.equal(local.audio_api_key, legacyCiphertext); assert.equal(other.enabled, true); assert.equal(other.rate_limit_per_phone_per_day, 20)
})
test('list/thread/note operations remain exact-tenant and retain pagination and ordered messages', async () => {
  await admin.query("INSERT INTO public.chat_messages(conversation_id,role,content,created_at) VALUES($1,'user','Question',now()),($1,'assistant','Answer',now()+interval '1 millisecond'),($2,'user','Foreign',now())", [conversation, foreign])
  const list = await run(false, query => readAdminChatConversations(query, context, new URLSearchParams('page=1&page_size=1&status=active')))
  assert.equal(list.total, 2); assert.equal(list.conversations.length, 1); assert.equal(list.page_size, 1)
  const thread = await run(false, query => readAdminChatThread(query, context, conversation))
  assert.deepEqual(thread.messages.map(row => row.content), ['Question', 'Answer']); assert.equal(thread.conversation.tenant_id, a)
  await assert.rejects(run(false, query => readAdminChatThread(query, context, foreign)), { status: 404 })
  await run(true, query => writeAdminChatNote(query, context, conversation, { admin_note: 'Reviewed', tenant_id: b }))
  assert.equal((await admin.query('SELECT admin_note FROM public.chat_conversations WHERE id=$1', [conversation])).rows[0].admin_note, 'Reviewed')
  await assert.rejects(run(true, query => writeAdminChatNote(query, context, foreign, { admin_note: 'Denied' })), { status: 404 })
})
test('current profile UID/role, reset/account controls and tenant binding deny stale contexts; verified superadmin preview remains valid', async () => {
  for (const patch of ["role='customer'", 'must_change_password=true', `tenant_id='${b}'`]) {
    await admin.query(`UPDATE public.profiles SET ${patch} WHERE id=$1`, [actor])
    await assert.rejects(run(true, query => writeAdminChatSettings(query, context, {})), { status: 403 })
    await admin.query("UPDATE public.profiles SET role='store-admin',must_change_password=false,tenant_id=$2 WHERE id=$1", [actor, a])
  }
  await admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1', [actor]); await assert.rejects(run(false, query => readAdminChatSettings(query, context)), { status: 403 })
  await assert.rejects(run(false, query => readAdminChatSettings(query, { ...context, actorId: staff, role: 'store-staff' })), { status: 403 })
  assert.ok((await run(false, query => readAdminChatSettings(query, { ...context, actorId: superadmin, role: 'superadmin' }))).settings)
})
test('block/unblock atomically affect all matching tenant conversations and attribute only the current profile UID', async () => {
  await block()
  let rows = (await admin.query('SELECT * FROM public.chat_blocked_phones')).rows
  assert.equal(rows.length, 1); const blockedId = rows[0].id, firstTime = rows[0].blocked_at; assert.equal(rows[0].blocked_by, actor)
  await run(true, query => blockAdminChatPhone(query, context, conversation, { reason: 'updated' }))
  rows = (await admin.query('SELECT * FROM public.chat_blocked_phones')).rows; assert.equal(rows[0].id, blockedId); assert.deepEqual(rows[0].blocked_at, firstTime); assert.equal(rows[0].reason, 'updated')
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.chat_conversations WHERE tenant_id=$1 AND status='blocked'", [a])).rows[0].n, 2)
  assert.equal((await admin.query('SELECT status FROM public.chat_conversations WHERE id=$1', [foreign])).rows[0].status, 'active')
  const list = await run(false, query => readAdminChatBlocked(query, context)); assert.equal(list.blocked.length, 1)
  await assert.rejects(run(true, query => unblockAdminChatPhone(query, { ...context, actorId: superadmin, tenantId: b, role: 'superadmin' }, blockedId)), { status: 404 })
  await run(true, query => unblockAdminChatPhone(query, context, blockedId))
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.chat_blocked_phones')).rows[0].n, 0); assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.chat_conversations WHERE tenant_id=$1 AND status='active'", [a])).rows[0].n, 2)
})
test('failed block updates roll back the inserted blocklist row, and failed unblock restores the deleted row', async () => {
  await admin.query("ALTER TABLE public.chat_conversations ADD CONSTRAINT fixture_refuse_block CHECK(status<>'blocked') NOT VALID")
  try { await assert.rejects(block(), { status: 503 }) } finally { await admin.query('ALTER TABLE public.chat_conversations DROP CONSTRAINT fixture_refuse_block') }
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.chat_blocked_phones')).rows[0].n, 0)
  await block(); const row = (await admin.query('SELECT * FROM public.chat_blocked_phones')).rows[0]
  await admin.query("ALTER TABLE public.chat_conversations ADD CONSTRAINT fixture_refuse_unblock CHECK(status<>'active') NOT VALID")
  try { await assert.rejects(run(true, query => unblockAdminChatPhone(query, context, row.id)), { status: 503 }) } finally { await admin.query('ALTER TABLE public.chat_conversations DROP CONSTRAINT fixture_refuse_unblock') }
  assert.deepEqual((await admin.query('SELECT * FROM public.chat_blocked_phones')).rows[0], row)
})
test('moderation and simultaneous saves on another same-phone conversation use one lock order without deadlock or partial state', async () => {
  for (let iteration = 0; iteration < 4; iteration++) {
    const existing = (await admin.query('SELECT id FROM public.chat_blocked_phones WHERE tenant_id=$1', [a])).rows[0]
    if (existing) await run(true, query => unblockAdminChatPhone(query, context, existing.id))
    const results = await Promise.allSettled([block(), save()])
    assert.equal(results[0].status, 'fulfilled')
    if (results[1].status === 'rejected') assert.equal(results[1].reason.status, 403)
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.chat_conversations WHERE tenant_id=$1 AND status='blocked'", [a])).rows[0].n, 2)
  }
  const count = (await admin.query('SELECT message_count FROM public.chat_conversations WHERE id=$1', [second])).rows[0].message_count
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.chat_messages WHERE conversation_id=$1', [second])).rows[0].n, count)
})
