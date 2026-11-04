// Only the loopback disposable CI database. No dotenv, app, provider or live SQL.
import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {ingestPublicAnalytics} from '../../src/lib/data/public-analytics'
import {adminMenuTransaction,createAdminMenusPool} from '../../src/lib/data/admin-menus-runtime'

const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable ingestion target required')
const target=new URL(raw)
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/xmartmenu_identity_test'||target.search||target.hash)throw Error('Not a disposable ingestion target')
const admin=new pg.Pool({connectionString:raw,max:2,statement_timeout:5000})
const pool=createAdminMenusPool({NODE_ENV:'production',PROD_DATABASE_HOST:target.hostname,PROD_DATABASE_NAME:'xmartmenu_identity_test',ADMIN_MENUS_DATABASE_URL:raw,ADMIN_MENUS_DATABASE_SSL:'disable'})
const a=randomUUID(),b=randomUUID(),menu=randomUUID(),second=randomUUID(),foreignMenu=randomUUID(),location=randomUUID(),foreignLocation=randomUUID(),qr=randomUUID(),foreignQr=randomUUID(),product=randomUUID(),foreignProduct=randomUUID(),category=randomUUID(),foreignCategory=randomUUID()
const now=new Date(),eventTime=now.toISOString()
const batch=(id=randomUUID())=>({session:{id,tenant_id:a,menu_id:menu,location_id:location,qr_code_id:qr,is_test:false,entry_source:'qr',device_class:'mobile',language:'en'},events:[{client_event_id:randomUUID(),event_name:'product_impression',product_id:product,occurred_at:eventTime}]})
const run=(input:unknown,date=now)=>adminMenuTransaction(pool,true,query=>ingestPublicAnalytics(query,input,date))
before(async()=>{
 await admin.query(`DROP TABLE IF EXISTS public.menu_events,public.menu_sessions,public.products,public.categories,public.qr_codes,public.locations,public.menus,public.tenant_settings,public.tenants CASCADE;
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,is_active boolean);
 CREATE TABLE public.menus(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),is_active boolean);
 CREATE TABLE public.locations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),menu_id uuid REFERENCES public.menus(id),is_active boolean);
 CREATE TABLE public.qr_codes(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id));
 CREATE TABLE public.products(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),menu_id uuid REFERENCES public.menus(id));
 CREATE TABLE public.categories(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),menu_id uuid REFERENCES public.menus(id));
 CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),analytics_enabled boolean);
 CREATE TABLE public.menu_sessions(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES public.tenants(id),menu_id uuid REFERENCES public.menus(id),location_id uuid REFERENCES public.locations(id),qr_code_id uuid REFERENCES public.qr_codes(id),is_test boolean NOT NULL,entry_source text,device_class text,language text,started_at timestamptz NOT NULL,last_seen_at timestamptz NOT NULL,CHECK(last_seen_at>=started_at));
 CREATE TABLE public.menu_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_event_id uuid UNIQUE,tenant_id uuid REFERENCES public.tenants(id),session_id uuid REFERENCES public.menu_sessions(id),menu_id uuid REFERENCES public.menus(id),location_id uuid REFERENCES public.locations(id),product_id uuid REFERENCES public.products(id),category_id uuid REFERENCES public.categories(id),event_name text,occurred_at timestamptz,duration_ms integer,quantity integer,source text,media_type text,media_index integer,query_length integer,order_id uuid,amount numeric,server_event_key text)`)
 await admin.query('INSERT INTO public.tenants VALUES($1,true),($2,true)',[a,b])
 await admin.query('INSERT INTO public.menus VALUES($1,$2,true),($3,$2,true),($4,$5,true)',[menu,a,second,foreignMenu,b])
 await admin.query('INSERT INTO public.locations VALUES($1,$2,$3,true),($4,$5,$6,true)',[location,a,menu,foreignLocation,b,foreignMenu])
 await admin.query('INSERT INTO public.qr_codes VALUES($1,$2),($3,$4)',[qr,a,foreignQr,b])
 await admin.query('INSERT INTO public.products VALUES($1,$2,$3),($4,$5,$6)',[product,a,menu,foreignProduct,b,foreignMenu])
 await admin.query('INSERT INTO public.categories VALUES($1,$2,$3),($4,$5,$6)',[category,a,menu,foreignCategory,b,foreignMenu])
 await admin.query('INSERT INTO public.tenant_settings VALUES($1,true),($2,true)',[a,b])
})
after(async()=>{await pool.end();await admin.end()})

test('concurrent exact replays create one session and one immutable client event but acknowledge each batch length',async()=>{
 const input=batch(),results=await Promise.all([run(input),run(input)])
 assert.deepEqual(results,[{ok:true,received:1},{ok:true,received:1}])
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0].n,1)
 const event=(await admin.query('SELECT * FROM public.menu_events WHERE client_event_id=$1',[input.events[0].client_event_id])).rows
 assert.equal(event.length,1);assert.equal(event[0].amount,null);assert.equal(event[0].order_id,null);assert.equal(event[0].server_event_key,null)
 const changed={...input,events:[{...input.events[0],event_name:'product_engagement',duration_ms:2000}]}
 assert.deepEqual(await run(changed),{ok:true,received:1})
 assert.equal((await admin.query('SELECT event_name FROM public.menu_events WHERE client_event_id=$1',[input.events[0].client_event_id])).rows[0].event_name,'product_impression')
})

test('session CAS preserves the complete immutable identity and refuses every changed scope before events',async()=>{
 const input=batch();await run(input)
 const original=(await admin.query('SELECT * FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0]
 for(const patch of [{tenant_id:b,menu_id:foreignMenu,location_id:foreignLocation,qr_code_id:foreignQr},{menu_id:second,location_id:null},{location_id:null},{qr_code_id:null},{is_test:true}]){
  const attempted={...input,session:{...input.session,...patch},events:[{...input.events[0],client_event_id:randomUUID(),product_id:patch.tenant_id===b?foreignProduct:product}]}
  // The menu-change case uses an event without a product, so entity validation
  // succeeds and the actual session identity CAS makes the decision.
  if(patch.menu_id===second)attempted.events=[{client_event_id:randomUUID(),event_name:'menu_session_started',occurred_at:eventTime} as typeof attempted.events[number]]
  await assert.rejects(run(attempted),{status:409})
 }
 assert.deepEqual((await admin.query('SELECT * FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0],original)
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_events WHERE session_id=$1',[input.session.id])).rows[0].n,1)
})

test('concurrent first-use identities sharing a session UUID cannot transfer its tenant',async()=>{
 const input=batch(),foreign={session:{...input.session,tenant_id:b,menu_id:foreignMenu,location_id:foreignLocation,qr_code_id:foreignQr},events:[{...input.events[0],client_event_id:randomUUID(),product_id:foreignProduct}]}
 const results=await Promise.allSettled([run(input),run(foreign)])
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1)
 const rejected=results.find(row=>row.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.status,409)
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_events WHERE session_id=$1',[input.session.id])).rows[0].n,1)
})

test('last-seen never moves backward and first visit metadata/timestamp remain fixed',async()=>{
 const input=batch();await run(input,new Date(now.getTime()+2000))
 const first=(await admin.query('SELECT * FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0]
 await run({...input,session:{...input.session,entry_source:'direct',device_class:'desktop',language:'pt'}},new Date(now.getTime()+1000))
 const after=(await admin.query('SELECT * FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0]
 assert.deepEqual(after,first)
})

test('foreign products/categories/location/QR and inactive menus cannot write sessions or events',async()=>{
 for(const kind of ['product','category','location','qr','menu']as const){
  const input=batch()
  const changed=kind==='product'?{...input,events:[{...input.events[0],product_id:foreignProduct}]}:kind==='category'?{...input,events:[{...input.events[0],event_name:'category_selected',product_id:undefined,category_id:foreignCategory}]}:{...input,session:{...input.session,...(kind==='location'?{location_id:foreignLocation}:kind==='qr'?{qr_code_id:foreignQr}:{menu_id:foreignMenu})}}
  await assert.rejects(run(changed),{status:kind==='menu'?404:400})
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0].n,0)
 }
 await admin.query('UPDATE public.menus SET is_active=false WHERE id=$1',[menu])
 try{await assert.rejects(run(batch()),{status:404})}finally{await admin.query('UPDATE public.menus SET is_active=true WHERE id=$1',[menu])}
})

test('disabled analytics acknowledges zero without creating a session',async()=>{
 const input=batch();await admin.query('UPDATE public.tenant_settings SET analytics_enabled=false WHERE tenant_id=$1',[a])
 try{assert.deepEqual(await run(input),{ok:true,received:0,disabled:true});assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0].n,0)}finally{await admin.query('UPDATE public.tenant_settings SET analytics_enabled=true WHERE tenant_id=$1',[a])}
})

test('an event constraint failure rolls back both a new session and an existing last-seen update',async()=>{
 const existing=batch();await run(existing)
 const before=(await admin.query('SELECT last_seen_at FROM public.menu_sessions WHERE id=$1',[existing.session.id])).rows[0].last_seen_at
 await admin.query("ALTER TABLE public.menu_events ADD CONSTRAINT fixture_reject_search CHECK(event_name<>'search_performed') NOT VALID")
 try{
  for(const input of [batch(),batch(existing.session.id)]){
   const search={...input,events:[{client_event_id:randomUUID(),event_name:'search_performed',query_length:3,occurred_at:eventTime}]}
   await assert.rejects(run(search,new Date(now.getTime()+3000)),{status:503})
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_events WHERE client_event_id=$1',[search.events[0].client_event_id])).rows[0].n,0)
   if(input.session.id!==existing.session.id)assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_sessions WHERE id=$1',[input.session.id])).rows[0].n,0)
  }
  assert.deepEqual((await admin.query('SELECT last_seen_at FROM public.menu_sessions WHERE id=$1',[existing.session.id])).rows[0].last_seen_at,before)
 }finally{await admin.query('ALTER TABLE public.menu_events DROP CONSTRAINT fixture_reject_search')}
})
