// Explicit disposable loopback target. No provider/Auth/Stripe or live SQL.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readPublicChatAudio, readPublicChatCatalog, readPublicChatTurn, countPublicChatMessages, savePublicChatTurn } from '../../src/lib/data/public-chat-turns'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable chat turns target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable chat turns target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), plan = randomUUID(), menu = randomUUID(), privateMenu = randomUUID(), otherMenu = randomUUID(), category = randomUUID(), product = randomUUID(), privateProduct = randomUUID(), foreignProduct = randomUUID(), group = randomUUID(), badGroup = randomUUID(), option = randomUUID(), ingredient = randomUUID(), otherIngredient = randomUUID(), conversation = randomUUID(), secondConversation = randomUUID(), otherConversation = randomUUID(), location = randomUUID()
const hash = 'tenant-scoped-anonymous-fixture', now = new Date()
const read = (slug = 'restaurant', id = conversation) => adminMenuTransaction(pool, false, query => readPublicChatTurn(query, slug, id))
const save = (patch: Partial<Parameters<typeof savePublicChatTurn>[1]> = {}) => adminMenuTransaction(pool, true, query => savePublicChatTurn(query, { slug: 'restaurant', tenantId: a, conversationId: conversation, user: 'Question', assistant: 'Answer', tokens: 12, voiceVerified: false, ...patch }))
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.chat_messages,public.chat_conversations,public.chat_blocked_phones,public.chat_addon_settings,public.product_options,public.product_option_groups,public.product_ingredients,public.ingredients,public.products,public.categories,public.menus,public.locations,public.delivery_zones,public.stripe_connections,public.tenant_settings,public.tenant_subscriptions,public.plans,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text UNIQUE,name text,is_active boolean);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,features jsonb,chat_addon_available boolean);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),status text,chat_addon_active boolean,chat_addon_override boolean);
    CREATE TABLE public.chat_addon_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),enabled boolean,rate_limit_per_phone_per_day int,openrouter_model text,text_enabled boolean,audio_enabled boolean,audio_provider text);
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),orders_enabled boolean,direct_orders_enabled boolean,whatsapp_orders_enabled boolean,dine_in_enabled boolean,pickup_enabled boolean,pickup_eta_minutes int,delivery_enabled boolean,delivery_fee_cents int,tips_enabled boolean,currency text,address text,city text,region text,postal_code text,country text,phone text,whatsapp text,instagram text,business_hours jsonb,business_type text,tagline text,about text,price_range text);
    CREATE TABLE public.menus(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),name text,is_active boolean,is_private boolean,is_default boolean,price_multiplier numeric,position int DEFAULT 0);
    CREATE TABLE public.categories(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),menu_id uuid REFERENCES public.menus(id),name text,description text,is_active boolean,position int DEFAULT 0);
    CREATE TABLE public.products(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),menu_id uuid REFERENCES public.menus(id),category_id uuid REFERENCES public.categories(id),name text,description text,price numeric,original_price numeric,tags jsonb,is_available boolean,position int DEFAULT 0);
    CREATE TABLE public.product_option_groups(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),product_id uuid REFERENCES public.products(id),name text,type text,required boolean,min_selections int,max_selections int,position int DEFAULT 0);
    CREATE TABLE public.product_options(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),group_id uuid REFERENCES public.product_option_groups(id),name text,base_price numeric,price_modifier numeric,is_available boolean,position int DEFAULT 0);
    CREATE TABLE public.ingredients(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),name text,is_available boolean);
    CREATE TABLE public.product_ingredients(tenant_id uuid REFERENCES public.tenants(id),product_id uuid REFERENCES public.products(id),ingredient_id uuid REFERENCES public.ingredients(id),is_default boolean,position int DEFAULT 0);
    CREATE TABLE public.locations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),name text,address text,city text,region text,postal_code text,country text,phone text,business_hours jsonb,is_active boolean);
    CREATE TABLE public.delivery_zones(tenant_id uuid REFERENCES public.tenants(id),name text,fee_cents int,is_active boolean);
    CREATE TABLE public.stripe_connections(tenant_id uuid REFERENCES public.tenants(id),stripe_account_id text,is_active boolean);
    CREATE TABLE public.chat_blocked_phones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES public.tenants(id),phone_hash text,UNIQUE(tenant_id,phone_hash));
    CREATE TABLE public.chat_conversations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),phone_hash text,status text DEFAULT 'active',message_count int DEFAULT 0,last_message_at timestamptz DEFAULT now());
    CREATE TABLE public.chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES public.chat_conversations(id),role text CHECK(role IN('user','assistant')),content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),tokens_used int)`)
  await admin.query("INSERT INTO public.tenants VALUES($1,'restaurant','Restaurant',true),($2,'foreign','Foreign',true)", [a, b])
  await admin.query('INSERT INTO public.plans VALUES($1,$2,true)', [plan, JSON.stringify(['payments', 'stripe-connect'])])
  await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,$3,'active',true,NULL),($2,$3,'active',true,NULL)", [a, b, plan])
  await admin.query("INSERT INTO public.chat_addon_settings VALUES($1,true,20,'test/model',true,true,'whisper'),($2,true,20,'test/model',true,true,'whisper')", [a, b])
  await admin.query("INSERT INTO public.tenant_settings(tenant_id,orders_enabled,direct_orders_enabled,delivery_enabled,currency,country) VALUES($1,true,true,true,'USD','US'),($2,true,true,true,'USD','US')", [a, b])
  await admin.query("INSERT INTO public.menus(id,tenant_id,name,is_active,is_private,is_default,price_multiplier) VALUES($1,$2,'Public',true,false,false,1.25),($3,$2,'Private',true,true,true,3),($4,$5,'Foreign',true,false,true,1)", [menu, a, privateMenu, otherMenu, b])
  await admin.query("INSERT INTO public.categories(id,tenant_id,menu_id,name,description,is_active) VALUES($1,$2,$3,'Food',NULL,true)", [category, a, menu])
  await admin.query("INSERT INTO public.products(id,tenant_id,menu_id,category_id,name,description,price,original_price,tags,is_available) VALUES($1,$2,$3,$4,'Public dish',NULL,10.25,NULL,'[\"fresh\"]',true),($5,$2,$6,NULL,'Private dish',NULL,30,NULL,NULL,true),($7,$8,$9,NULL,'Foreign dish',NULL,99,NULL,NULL,true)", [product, a, menu, category, privateProduct, privateMenu, foreignProduct, b, otherMenu])
  await admin.query("INSERT INTO public.product_option_groups(id,tenant_id,product_id,name,type,required,min_selections,max_selections) VALUES($1,$2,$3,'Size','single',true,1,1),($4,$5,$3,'Wrong tenant','single',true,1,1)", [group, a, product, badGroup, b])
  await admin.query("INSERT INTO public.product_options(id,tenant_id,group_id,name,base_price,price_modifier,is_available) VALUES($1,$2,$3,'Large',12.50,0,true),($4,$2,$3,'Unavailable',NULL,1,false),($5,$6,$3,'Wrong tenant',NULL,100,true)", [option, a, group, randomUUID(), randomUUID(), b])
  await admin.query("INSERT INTO public.ingredients VALUES($1,$2,'Cheese',true),($3,$4,'Foreign ingredient',true)", [ingredient, a, otherIngredient, b])
  await admin.query('INSERT INTO public.product_ingredients(tenant_id,product_id,ingredient_id,is_default) VALUES($1,$2,$3,true),($1,$2,$4,true)', [a, product, ingredient, otherIngredient])
  await admin.query("INSERT INTO public.locations(id,tenant_id,name,country,is_active) VALUES($1,$2,'Branch','US',true)", [location, a])
  await admin.query("INSERT INTO public.delivery_zones VALUES($1,'Local',250,true),($2,'Foreign',999,true)", [a, b])
  await admin.query("INSERT INTO public.stripe_connections VALUES($1,'public-account-id',true)", [a])
  await admin.query('INSERT INTO public.chat_conversations(id,tenant_id,phone_hash) VALUES($1,$2,$3),($4,$2,$3),($5,$6,$3)', [conversation, a, hash, secondConversation, otherConversation, b])
})
beforeEach(async () => {
  await admin.query('DELETE FROM public.chat_messages'); await admin.query('DELETE FROM public.chat_blocked_phones')
  await admin.query("UPDATE public.chat_conversations SET status='active',message_count=0,last_message_at=now()")
  await admin.query('UPDATE public.chat_addon_settings SET enabled=true,text_enabled=true,audio_enabled=true,rate_limit_per_phone_per_day=20')
  await admin.query('UPDATE public.tenants SET is_active=true')
})
after(async () => { await pool.end(); await admin.end() })
test('anonymous catalog rejects private/foreign selection and scopes every child while preserving prices/options/ingredients', async () => {
  for (const selected of [privateMenu, otherMenu, menu]) {
    const result = await adminMenuTransaction(pool, false, query => readPublicChatCatalog(query, a, 'USD', selected))
    assert.deepEqual(result, { menuName: 'Public', currency: 'USD', priceMultiplier: 1.25, categories: [{ id: category, name: 'Food', description: null }], products: [{ id: product, category_id: category, name: 'Public dish', description: null, price: 10.25, original_price: null, tags: ['fresh'], groups: [{ id: group, name: 'Size', type: 'single', required: true, min_selections: 1, max_selections: 1, options: [{ id: option, name: 'Large', base_price: 12.5, price_modifier: 0 }] }], ingredients: [{ name: 'Cheese', is_default: true }] }] })
  }
  const context = await read(); assert.equal(context.catalog?.menuName, 'Public'); assert.equal(context.canAddToCart, true); assert.equal(context.onlinePayment, true); assert.deepEqual(context.zones, [{ name: 'Local', fee_cents: 250 }]); assert.equal(context.locations[0].id, location)
})
test('foreign, blocked and inactive conversation/tenant/addon controls fail before returning context', async () => {
  await assert.rejects(read('restaurant', otherConversation), { status: 400 })
  await admin.query("UPDATE public.chat_conversations SET status='blocked' WHERE id=$1", [conversation]); await assert.rejects(read(), { status: 403 })
  await admin.query("UPDATE public.chat_conversations SET status='active' WHERE id=$1", [conversation])
  await admin.query('INSERT INTO public.chat_blocked_phones(tenant_id,phone_hash) VALUES($1,$2)', [a, hash]); await assert.rejects(read(), { status: 403 }); await admin.query('DELETE FROM public.chat_blocked_phones')
  await admin.query('UPDATE public.tenants SET is_active=false WHERE id=$1', [a]); await assert.rejects(read(), { status: 404 }); await admin.query('UPDATE public.tenants SET is_active=true WHERE id=$1', [a])
  await admin.query('UPDATE public.chat_addon_settings SET enabled=false WHERE tenant_id=$1', [a]); await assert.rejects(read(), { status: 403 })
})
test('daily count includes only current tenant/hash user turns across conversations in the last 24 hours', async () => {
  await admin.query("INSERT INTO public.chat_messages(conversation_id,role,content,created_at) VALUES($1,'user','A',$4),($2,'user','B',$4),($3,'user','Foreign',$4),($1,'assistant','Answer',$4),($1,'user','Old',$5)", [conversation, secondConversation, otherConversation, now.toISOString(), new Date(now.getTime() - 90000000).toISOString()])
  assert.equal(await adminMenuTransaction(pool, false, query => countPublicChatMessages(query, a, hash, now)), 2)
})
test('concurrent completed turns persist both pairs and increment aggregates without lost updates', async () => {
  await Promise.all([save(), save({ user: 'Other question', assistant: 'Other answer' })])
  const conversationRow = (await admin.query('SELECT * FROM public.chat_conversations WHERE id=$1', [conversation])).rows[0]
  const messages = (await admin.query('SELECT role,content,tokens_used FROM public.chat_messages WHERE conversation_id=$1', [conversation])).rows
  assert.equal(conversationRow.message_count, 4); assert.equal(messages.length, 4); assert.equal(messages.filter(row => row.role === 'assistant' && row.tokens_used === 12).length, 2)
})
test('serialized final quota admits only one remaining user turn and returns a typed limit denial for the other', async () => {
  await admin.query("INSERT INTO public.chat_messages(conversation_id,role,content) SELECT $1,'user','Previous' FROM generate_series(1,19)", [conversation])
  const results = await Promise.allSettled([save(), save({ conversationId: secondConversation })])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  const rejected = results.find(row => row.status === 'rejected') as PromiseRejectedResult; assert.equal(rejected.reason.status, 429); assert.equal(rejected.reason.limit, 20); assert.equal(rejected.reason.used, 20)
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.chat_messages WHERE role='user'")).rows[0].n, 20)
})
test('controls changed after the read snapshot are rechecked before persistence, including voice-only mode', async () => {
  await read()
  await admin.query('INSERT INTO public.chat_blocked_phones(tenant_id,phone_hash) VALUES($1,$2)', [a, hash]); await assert.rejects(save(), { status: 403 }); await admin.query('DELETE FROM public.chat_blocked_phones')
  await admin.query('UPDATE public.chat_addon_settings SET text_enabled=false WHERE tenant_id=$1', [a]); await assert.rejects(save(), { status: 403 }); await save({ voiceVerified: true })
  await assert.rejects(save({ tenantId: b }), { status: 400 })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.chat_messages')).rows[0].n, 2)
})
test('assistant insert rejection rolls back the user turn and conversation aggregate together', async () => {
  const before = (await admin.query('SELECT * FROM public.chat_conversations WHERE id=$1', [conversation])).rows[0]
  await admin.query("ALTER TABLE public.chat_messages ADD CONSTRAINT fixture_refuse_assistant CHECK(role<>'assistant') NOT VALID")
  try { await assert.rejects(save(), { status: 503 }) } finally { await admin.query('ALTER TABLE public.chat_messages DROP CONSTRAINT fixture_refuse_assistant') }
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.chat_messages')).rows[0].n, 0)
  assert.deepEqual((await admin.query('SELECT * FROM public.chat_conversations WHERE id=$1', [conversation])).rows[0], before)
})
test('audio requires a current owned-tenant conversation, audio switch and current phone blocklist', async () => {
  assert.equal((await adminMenuTransaction(pool, false, query => readPublicChatAudio(query, 'restaurant', conversation))).tenant.id, a)
  await assert.rejects(adminMenuTransaction(pool, false, query => readPublicChatAudio(query, 'restaurant', otherConversation)), { status: 400 })
  await admin.query('UPDATE public.chat_addon_settings SET audio_enabled=false WHERE tenant_id=$1', [a]); await assert.rejects(adminMenuTransaction(pool, false, query => readPublicChatAudio(query, 'restaurant', conversation)), { status: 503 })
  await admin.query('UPDATE public.chat_addon_settings SET audio_enabled=true WHERE tenant_id=$1', [a]); await admin.query('INSERT INTO public.chat_blocked_phones(tenant_id,phone_hash) VALUES($1,$2)', [a, hash]); await assert.rejects(adminMenuTransaction(pool, false, query => readPublicChatAudio(query, 'restaurant', conversation)), { status: 403 })
})
