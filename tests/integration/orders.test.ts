// Disposable loopback CI fixture only. No dotenv, provider, live migration or app startup.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { assertOrderRpcCompatibility, assertUnambiguousOrderOptionPricing, OwnedOrderRepository, type OrderPriceGroup, type OrderQuery } from '../../src/lib/data/orders'
import { createOrdersPool, orderTransaction } from '../../src/lib/data/orders-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not an isolated orders target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
const pool = createOrdersPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ORDERS_DATABASE_URL: raw, ORDERS_DATABASE_SSL: 'disable' })
const a = randomUUID(), b = randomUUID(), menu = randomUUID(), foreignMenu = randomUUID(), product = randomUUID(), foreignProduct = randomUUID(), session = randomUUID()
const context = { tenantId: a, role: 'store-admin' as const }
const run = <T>(write: boolean, action: (repository: OwnedOrderRepository, query: OrderQuery) => Promise<T>, tenantId = a) =>
  orderTransaction(pool,write,query => action(new OwnedOrderRepository(query,tenantId),query))
const items = [{ product_id: product, product_name: 'Database dish', quantity: 2, unit_price: 12.5,
  notes: null, selected_options: null, ingredient_modifications: null, added_via: null }]
const order = (patch: Record<string, unknown> = {}) => ({ tenant_id: a, customer_id: null, customer_name: 'Fixture guest', customer_phone: 'fixture phone',
  customer_phone_key: null, customer_phone_e164: null, status: 'pending', total: 25, subtotal: 25, currency: null,
  order_type: 'dine_in', idempotency_key: randomUUID(), request_fingerprint: randomUUID(), ...patch })
const create = async (patch: Record<string, unknown> = {}, itemRows = items) => (await run(true,r => r.create(order(patch),itemRows,null))).data!

before(async () => {
  // Minimal typed tables for this seam. The actual restored PL/pgSQL definition
  // below is executed verbatim; no trigger/Auth/RLS/seed/backfill is imported.
  await admin.query(`DROP FUNCTION IF EXISTS public.create_order_with_items(jsonb,jsonb);
    DROP TABLE IF EXISTS public.menu_events,public.order_items,public.orders,public.menu_sessions,
      public.product_options,public.product_option_groups,public.product_ingredients,public.ingredients,
      public.products,public.restaurant_tables,public.delivery_zones,public.locations,public.menus,
      public.tenant_subscriptions,public.plans,public.stripe_connections,public.tenant_settings,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
      orders_enabled boolean,direct_orders_enabled boolean,table_management_enabled boolean,whatsapp_orders_enabled boolean,whatsapp text,
      tips_enabled boolean,item_notes_enabled boolean,ingredient_customization_enabled boolean,dine_in_enabled boolean,pickup_enabled boolean,
      delivery_enabled boolean,upsell_enabled boolean,delivery_fee_cents integer,currency text,country text,
      amber_threshold_minutes integer,red_threshold_minutes integer);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,features jsonb NOT NULL);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY,plan_id uuid REFERENCES public.plans(id),status text);
    CREATE TABLE public.stripe_connections(id uuid PRIMARY KEY,tenant_id uuid,is_active boolean,private_credential text);
    CREATE TABLE public.menus(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),is_active boolean,is_private boolean,price_multiplier numeric);
    CREATE TABLE public.locations(id uuid PRIMARY KEY,tenant_id uuid,is_active boolean,name text,slug text,created_at timestamptz DEFAULT now(),private_marker text);
    CREATE TABLE public.restaurant_tables(id uuid PRIMARY KEY,tenant_id uuid,is_active boolean,name text);
    CREATE TABLE public.delivery_zones(id uuid PRIMARY KEY,tenant_id uuid,is_active boolean,fee_cents integer,zipcode_prefixes text[],created_at timestamptz DEFAULT now());
    CREATE TABLE public.products(id uuid PRIMARY KEY,tenant_id uuid,menu_id uuid REFERENCES public.menus(id),name text,price numeric,is_available boolean);
    CREATE TABLE public.product_option_groups(id uuid PRIMARY KEY,tenant_id uuid,product_id uuid,name text,type text,required boolean,min_selections integer,max_selections integer,position integer);
    CREATE TABLE public.product_options(id uuid PRIMARY KEY,tenant_id uuid,group_id uuid,name text,base_price numeric,price_modifier numeric,is_available boolean,position integer);
    CREATE TABLE public.ingredients(id uuid PRIMARY KEY,tenant_id uuid,name text,default_extra_price numeric,default_add_price numeric);
    CREATE TABLE public.product_ingredients(product_id uuid,ingredient_id uuid,tenant_id uuid,extra_price_override numeric,add_price_override numeric);
    CREATE TABLE public.menu_sessions(id uuid PRIMARY KEY,tenant_id uuid,menu_id uuid,location_id uuid);
    CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
      customer_name text NOT NULL,customer_phone text NOT NULL,customer_phone_key text,customer_id uuid,customer_phone_e164 text,
      customer_linked_at timestamptz,customer_link_method text,status text NOT NULL,total numeric(10,2) NOT NULL,subtotal numeric(10,2),currency text,
      delivery_fee_cents integer,payment_intent_id text,order_type text,delivery_address text,delivery_street text,delivery_complement text,
      delivery_zipcode text,delivery_city text,delivery_notes text,delivery_zone_id uuid,location_id uuid,tip_cents integer,table_name text,table_id uuid,
      analytics_session_id uuid,notes text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),idempotency_key text,request_fingerprint text,
      private_marker text DEFAULT 'not-an-api-field');
    CREATE UNIQUE INDEX orders_tenant_idempotency_key ON public.orders(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE public.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.orders(id),
      product_id uuid NOT NULL,product_name text NOT NULL,quantity integer NOT NULL,unit_price numeric(10,2) NOT NULL,notes text,selected_options jsonb,
      ingredient_modifications jsonb,added_via text,private_marker text DEFAULT 'not-an-api-field');
    CREATE TABLE public.menu_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_event_id uuid UNIQUE,server_event_key text UNIQUE,
      tenant_id uuid,session_id uuid,menu_id uuid,location_id uuid,order_id uuid,event_name text,occurred_at timestamptz,amount numeric,source text);`)
  const source = (await readFile(new URL('../../supabase/migrations/20261027095000_order_customer_identity.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n')
  const definition = source.match(/CREATE OR REPLACE FUNCTION public\.create_order_with_items\(p_order JSONB, p_items JSONB\)[\s\S]*?\$\$;/)?.[0]
  assert.ok(definition)
  await admin.query(definition)
  await admin.query('REVOKE EXECUTE ON FUNCTION public.create_order_with_items(jsonb,jsonb) FROM PUBLIC')
  await admin.query('INSERT INTO public.tenants(id) VALUES($1),($2)',[a,b])
  await admin.query('INSERT INTO public.tenant_settings(tenant_id,orders_enabled,direct_orders_enabled,table_management_enabled,currency,country,amber_threshold_minutes,red_threshold_minutes) VALUES($1,true,true,true,NULL,\'US\',8,15)',[a])
  const plan = randomUUID()
  await admin.query('INSERT INTO public.plans(id,features) VALUES($1,$2)',[plan,JSON.stringify(['orders','payments','stripe-connect'])])
  await admin.query('INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,status) VALUES($1,$2,\'active\')',[a,plan])
  await admin.query('INSERT INTO public.menus VALUES($1,$2,true,false,1.25),($3,$4,true,false,1)',[menu,a,foreignMenu,b])
  await admin.query('INSERT INTO public.products VALUES($1,$2,$3,\'Database dish\',10,true),($4,$5,$6,\'Foreign dish\',99,true)',[product,a,menu,foreignProduct,b,foreignMenu])
  await admin.query('INSERT INTO public.menu_sessions(id,tenant_id,menu_id) VALUES($1,$2,$3)',[session,a,menu])
})
after(async () => { await pool.end(); await admin.end() })

test('exact restored RPC signature/body/index and runtime EXECUTE are checked before writes', async () => {
  await run(false,async (_r,query) => assertOrderRpcCompatibility(query))
  await admin.query('DROP ROLE IF EXISTS xmart_orders_exec_probe; CREATE ROLE xmart_orders_exec_probe NOLOGIN')
  try {
    await assert.rejects(run(false,async (_r,query) => {
      await query('SET LOCAL ROLE xmart_orders_exec_probe')
      await assertOrderRpcCompatibility(query)
    }),{ status: 503 })
  } finally { await admin.query('DROP ROLE xmart_orders_exec_probe') }
})

test('server-side catalog and live subscription/Stripe-presence reads remain tenant scoped', async () => {
  const settings = await run(false,r => r.tenantSettings())
  assert.equal(settings.data?.tenant_settings?.currency,null)
  assert.equal((await run(false,r => r.capabilities())).guestOrdering,true)
  assert.equal(await run(false,r => r.stripeEnabled()),false)
  await admin.query('INSERT INTO public.stripe_connections VALUES($1,$2,true,$3)',[randomUUID(),a,randomUUID()])
  assert.equal(await run(false,r => r.stripeEnabled()),true)
  const catalog = await run(true,r => r.products([product,foreignProduct]))
  assert.equal(catalog.data.length,1); assert.equal(catalog.data[0].id,product)
  assert.equal(catalog.data[0].price,10); assert.equal(catalog.data[0].menus.price_multiplier,1.25)
  await admin.query('UPDATE public.tenant_subscriptions SET status=\'past_due\' WHERE tenant_id=$1',[a])
  assert.equal((await run(false,r => r.capabilities())).guestOrdering,false)
  assert.equal(await run(false,r => r.stripeEnabled()),false)
  await admin.query('UPDATE public.tenant_subscriptions SET status=\'active\' WHERE tenant_id=$1',[a])
})

test('order/items commit atomically with NULL historical currency and unchanged trusted values', async () => {
  const created = await create()
  const stored = (await admin.query('SELECT * FROM public.orders WHERE id=$1',[created.id])).rows[0]
  assert.equal(stored.tenant_id,a); assert.equal(stored.currency,null); assert.equal(stored.total,'25.00')
  const lines = (await admin.query('SELECT * FROM public.order_items WHERE order_id=$1',[created.id])).rows
  assert.equal(lines.length,1); assert.equal(lines[0].product_id,product); assert.equal(lines[0].unit_price,'12.50')
  const before = (await admin.query('SELECT count(*)::int AS count FROM public.orders')).rows[0].count
  await assert.rejects(create({},[...items,{ ...items[0], product_name: null as unknown as string }]),{ status: 503 })
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.orders')).rows[0].count,before)
})

test('optional analytics lookup recovers missing-table/statement-timeout aborts and checkout still commits', async () => {
  await admin.query('ALTER TABLE public.menu_sessions RENAME TO menu_sessions_unavailable')
  let id: string | undefined
  try {
    const created = await run(true,async repository => {
      const attribution = await repository.analyticsSession(session)
      assert.equal(attribution.data,null)
      return repository.create(order({ analytics_session_id:null }),items,null)
    })
    id = created.data!.id
  } finally { await admin.query('ALTER TABLE public.menu_sessions_unavailable RENAME TO menu_sessions') }
  const stored=(await admin.query('SELECT analytics_session_id FROM public.orders WHERE id=$1',[id])).rows[0]
  assert.equal(stored.analytics_session_id,null)
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.order_items WHERE order_id=$1',[id])).rows[0].count,1)
  const timedOut = await orderTransaction(pool,true,async query => {
    const wrapped: OrderQuery = async (text,values) => {
      if (text.includes('FROM public.menu_sessions')) {
        await query("SET LOCAL statement_timeout='5ms'")
        return query('SELECT pg_sleep(0.05)')
      }
      return query(text,values)
    }
    const repository=new OwnedOrderRepository(wrapped,a)
    assert.equal((await repository.analyticsSession(session)).data,null)
    return repository.create(order({ analytics_session_id:null }),items,null)
  })
  assert.equal((await admin.query('SELECT analytics_session_id FROM public.orders WHERE id=$1',[timedOut.data!.id])).rows[0].analytics_session_id,null)
})

test('restored tied option positions cannot silently choose a different selected reset/add price', async () => {
  const additive=randomUUID(),reset=randomUUID(),aOption=randomUUID(),bOption=randomUUID()
  await admin.query(`INSERT INTO public.product_option_groups(id,tenant_id,product_id,name,type,position)
    VALUES($1,$2,$3,'Extras','multiple',0),($4,$2,$3,'Size','single',0)`,[additive,a,product,reset])
  await admin.query(`INSERT INTO public.product_options(id,tenant_id,group_id,name,base_price,price_modifier,is_available,position)
    VALUES($1,$2,$3,'Extra',NULL,2,true,0),($4,$2,$5,'Large',20,0,true,0)`,[aOption,a,additive,bOption,reset])
  const editor={ multiSelections:{ [additive]:[aOption] },singleSelections:{ [reset]:bOption } }
  const load=async()=> (await run(false,r=>r.optionGroups([product]))).data.map(g=>({ ...g,options:g.product_options })) as unknown as OrderPriceGroup[]
  const tied=await load()
  assert.throws(()=>assertUnambiguousOrderOptionPricing(10,editor,tied),{ status:503 })
  await admin.query('UPDATE public.product_option_groups SET position=1 WHERE id=$1',[reset])
  const ordered=await load()
  assert.doesNotThrow(()=>assertUnambiguousOrderOptionPricing(10,editor,ordered))
})

test('concurrent identical idempotent checkouts return one order and one item set without retries', async () => {
  const payload = { idempotency_key: randomUUID(),request_fingerprint: randomUUID() }
  const [one,two] = await Promise.all([create(payload),create(payload)])
  assert.equal(one.id,two.id); assert.deepEqual([one.replayed,two.replayed].sort(),[false,true])
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.order_items WHERE order_id=$1',[one.id])).rows[0].count,1)
  await assert.rejects(create({ ...payload,request_fingerprint: randomUUID(),total: 26 }),{ status: 409 })
  assert.equal((await admin.query('SELECT total FROM public.orders WHERE id=$1',[one.id])).rows[0].total,'25.00')
})

test('tenant references, forged customer authority and inactive products stop before RPC insertion', async () => {
  await assert.rejects(create({},[{ ...items[0],product_id: foreignProduct }]),{ status: 409 })
  await assert.rejects(create({ customer_id: randomUUID() }),{ status: 400 })
  await assert.rejects(create({ location_id: randomUUID() }),{ status: 400 })
  await admin.query('UPDATE public.products SET is_available=false WHERE id=$1',[product])
  await assert.rejects(create(),{ status: 409 })
  await admin.query('UPDATE public.products SET is_available=true WHERE id=$1',[product])
})

test('KDS projects tenant-only recent orders/items and does not expose new internal columns', async () => {
  const created = await create()
  await admin.query('INSERT INTO public.orders(tenant_id,customer_name,customer_phone,status,total,created_at) VALUES($1,\'Other\',\'fixture\',\'pending\',99,now()),($2,\'Old\',\'fixture\',\'pending\',99,now()-interval \'3 days\')',[b,a])
  const found = await run(false,r => r.list(context,new Date(Date.now()-48*3600000).toISOString()))
  assert.ok(found.data.some(o => o.id===created.id))
  assert.ok(found.data.every(o => o.tenant_id===a && !Object.hasOwn(o,'private_marker') && !Object.hasOwn(o,'idempotency_key')))
  assert.ok(found.data.every(o => o.order_items.every(i => !Object.hasOwn(i,'private_marker'))))
  await assert.rejects(run(false,r => r.list({ tenantId:a,role:'customer' },new Date().toISOString())),{ status:403 })
})

test('KDS SSR bootstrap reads orders, item details, thresholds, active locations and plan capability in one owned snapshot', async () => {
  const created = await create()
  const location = randomUUID(), inactive = randomUUID(), foreignLocation = randomUUID()
  await admin.query(`INSERT INTO public.locations(id,tenant_id,is_active,name,slug,private_marker) VALUES
    ($1,$2,true,'Kitchen','kitchen','hidden'),($3,$2,false,'Closed','closed','hidden'),($4,$5,true,'Foreign','foreign','hidden')`,
  [location,a,inactive,foreignLocation,b])
  const cutoff = new Date(Date.now()-48*3600000).toISOString()
  const bootstrap = await run(false,repository => repository.kdsBootstrap(context,cutoff))
  assert.equal(bootstrap.capabilities.kds,true)
  assert.equal(bootstrap.amberThreshold,8)
  assert.equal(bootstrap.redThreshold,15)
  assert.equal(bootstrap.currency,'USD')
  assert.deepEqual(bootstrap.locations,[{ id:location,name:'Kitchen',slug:'kitchen' }])
  assert.equal(bootstrap.orders.find(order => order.id===created.id)?.order_items.length,1)
  assert.equal(Object.hasOwn(bootstrap.locations[0] as object,'private_marker'),false)
})

test('kitchen mutations preserve ownership, payment state boundaries and compare-and-set races', async () => {
  const created = await create()
  await assert.rejects(run(true,r => r.move(context,created.id,'paid')),{ status:409 })
  await assert.rejects(run(true,r => r.move({ tenantId:b,role:'store-admin' },created.id,'preparing')),{ status:403 })
  await assert.rejects(run(true,r => r.move({ tenantId:b,role:'store-admin' },created.id,'preparing'),b),{ status:404 })
  await assert.rejects(orderTransaction(pool,true,async query => {
    const wrapped: OrderQuery = async (text,values) => {
      const result=await query(text,values)
      if(text.startsWith('SELECT id,status,order_type')) await admin.query('UPDATE public.orders SET status=\'paid\' WHERE id=$1',[created.id])
      return result
    }
    return new OwnedOrderRepository(wrapped,a).move(context,created.id,'preparing')
  }),{ status:409 })
  assert.equal((await admin.query('SELECT status FROM public.orders WHERE id=$1',[created.id])).rows[0].status,'paid')
  assert.equal((await run(true,r => r.move(context,created.id,'preparing'))).status,'preparing')
})

test('trusted analytics is idempotent and a missing analytics table cannot roll back kitchen status', async () => {
  const created = await create({ analytics_session_id:session })
  await run(true,async r => { await r.recordAnalytics(created.id,'order_created'); await r.recordAnalytics(created.id,'order_created') })
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.menu_events WHERE order_id=$1',[created.id])).rows[0].count,1)
  await admin.query('DROP TABLE public.menu_events')
  assert.equal((await run(true,r => r.move(context,created.id,'cancelled'))).status,'cancelled')
  assert.equal((await admin.query('SELECT status FROM public.orders WHERE id=$1',[created.id])).rows[0].status,'cancelled')
})
