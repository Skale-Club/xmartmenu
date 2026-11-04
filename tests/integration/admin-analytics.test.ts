// Projection fixtures and original RPC definitions, disposable loopback CI only.
import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {ANALYTICS_SQL} from '../../src/lib/data/admin-analytics-sql'
import {readAdminAnalytics,type AnalyticsWindow} from '../../src/lib/data/admin-analytics'
import {adminMenuTransaction,createAdminMenusPool} from '../../src/lib/data/admin-menus-runtime'
import type {AdminMenuQuery} from '../../src/lib/data/admin-menus'

const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable analytics target required')
const target=new URL(raw)
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/xmartmenu_identity_test'||target.search||target.hash)throw Error('Not a disposable analytics target')
const admin=new pg.Pool({connectionString:raw,max:2,statement_timeout:5000})
const pool=createAdminMenusPool({NODE_ENV:'production',PROD_DATABASE_HOST:target.hostname,PROD_DATABASE_NAME:'xmartmenu_identity_test',ADMIN_MENUS_DATABASE_URL:raw,ADMIN_MENUS_DATABASE_SSL:'disable'})
const a=randomUUID(),b=randomUUID(),menu=randomUUID(),menu2=randomUUID(),foreignMenu=randomUUID(),location=randomUUID(),location2=randomUUID(),product=randomUUID(),product2=randomUUID(),foreignProduct=randomUUID()
const s1=randomUUID(),s2=randomUUID(),sTest=randomUUID(),sPrevious=randomUUID(),sForeign=randomUUID(),o1=randomUUID(),o2=randomUUID(),oForeign=randomUUID()
const context={tenantId:a,role:'store-admin' as const}
const window:AnalyticsWindow={startedAt:'2026-10-01T00:00:00Z',endedAt:'2026-10-08T00:00:00Z',previousStartedAt:'2026-09-24T00:00:00Z',menuId:null,locationId:null}
const read=(filter=window)=>adminMenuTransaction(pool,false,query=>readAdminAnalytics(query,context,filter))

before(async()=>{
 await admin.query(`DROP TABLE IF EXISTS public.menu_events,public.menu_sessions,public.order_items,public.orders,public.products,
 public.menus,public.locations,public.tenant_subscriptions,public.plans,public.tenant_settings CASCADE;
 CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY,currency text,country text,region text,analytics_enabled boolean,visual_feed_enabled boolean,menu_default_view text,feed_autoplay_videos boolean,
 orders_enabled boolean,direct_orders_enabled boolean,table_management_enabled boolean,whatsapp_orders_enabled boolean,whatsapp text,tips_enabled boolean,item_notes_enabled boolean,ingredient_customization_enabled boolean,dine_in_enabled boolean,pickup_enabled boolean,delivery_enabled boolean,upsell_enabled boolean);
 CREATE TABLE public.menus(id uuid PRIMARY KEY,tenant_id uuid,name text,position integer);
 CREATE TABLE public.locations(id uuid PRIMARY KEY,tenant_id uuid,name text,is_active boolean);
 CREATE TABLE public.plans(id uuid PRIMARY KEY,features jsonb);
 CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY,plan_id uuid,status text);
 CREATE TABLE public.products(id uuid PRIMARY KEY,tenant_id uuid,menu_id uuid,name text,price numeric);
 CREATE TABLE public.orders(id uuid PRIMARY KEY,tenant_id uuid,created_at timestamptz,status text,total numeric,location_id uuid);
 CREATE TABLE public.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,product_id uuid,quantity integer,unit_price numeric,added_via text);
 CREATE TABLE public.menu_sessions(id uuid PRIMARY KEY,tenant_id uuid,menu_id uuid,location_id uuid,is_test boolean,started_at timestamptz,last_seen_at timestamptz,device_class text,entry_source text,language text);
 CREATE TABLE public.menu_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,session_id uuid,event_name text,occurred_at timestamptz,order_id uuid,product_id uuid,duration_ms integer,amount numeric,quantity integer)`)
 await admin.query("INSERT INTO public.tenant_settings(tenant_id,currency,country,region,analytics_enabled,visual_feed_enabled,menu_default_view,feed_autoplay_videos,orders_enabled,direct_orders_enabled,table_management_enabled,dine_in_enabled) VALUES($1,NULL,'BR','SP',true,true,'feed',false,true,true,true,true)",[a])
 const plan=randomUUID();await admin.query('INSERT INTO public.plans VALUES($1,$2)',[plan,JSON.stringify(['orders','payments'])]);await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,$2,'active')",[a,plan])
 await admin.query("INSERT INTO public.menus VALUES($1,$2,'Main',0),($3,$2,'Second',1),($4,$5,'Foreign',0)",[menu,a,menu2,foreignMenu,b])
 await admin.query("INSERT INTO public.locations VALUES($1,$2,'Visible',true),($3,$2,'Inactive',false)",[location,a,location2])
 await admin.query("INSERT INTO public.products VALUES($1,$2,$3,'Dish',12.35),($4,$2,$5,'Side',2),($6,$7,$8,'Foreign',999)",[product,a,menu,product2,menu2,foreignProduct,b,foreignMenu])
 await admin.query("INSERT INTO public.orders VALUES($1,$2,'2026-10-02','paid',25.70,$3),($4,$2,'2026-10-03','cancelled',10,$5),($6,$7,'2026-10-02','paid',999,$3)",[o1,a,location,o2,location2,oForeign,b])
 await admin.query("INSERT INTO public.order_items(order_id,product_id,quantity,unit_price,added_via) VALUES($1,$2,2,12.35,'upsell'),($3,$4,1,10,'chat'),($5,$6,1,999,NULL)",[o1,product,o2,product2,oForeign,foreignProduct])
 const sessions=[{id:s1,tenant:a,menu,location,start:'2026-10-02T01:00:00Z',end:'2026-10-02T01:02:00Z',test:false},{id:s2,tenant:a,menu:menu2,location:location2,start:'2026-10-03T10:00:00Z',end:'2026-10-04T10:00:00Z',test:false},{id:sTest,tenant:a,menu,location,start:'2026-10-04T10:00:00Z',end:'2026-10-04T10:00:10Z',test:true},{id:sPrevious,tenant:a,menu,location,start:'2026-09-26T10:00:00Z',end:'2026-09-26T10:00:30Z',test:false},{id:sForeign,tenant:b,menu:foreignMenu,location,start:'2026-10-02T10:00:00Z',end:'2026-10-02T10:01:00Z',test:false}]
 for(const session of sessions)await admin.query("INSERT INTO public.menu_sessions VALUES($1,$2,$3,$4,$5,$6,$7,'mobile','qr','pt')",[session.id,session.tenant,session.menu,session.location,session.test,session.start,session.end])
 const event=async(session:string,name:string,productId:string|null=null,orderId:string|null=null,amount:number|null=null,quantity=1)=>{
  const info=sessions.find(row=>row.id===session)!;await admin.query('INSERT INTO public.menu_events(tenant_id,session_id,event_name,occurred_at,order_id,product_id,duration_ms,amount,quantity) VALUES($1,$2,$3,$4,$5,$6,1500,$7,$8)',[info.tenant,session,name,new Date(Date.parse(info.start)+60000).toISOString(),orderId,productId,amount,quantity])
 }
 for(const name of ['product_impression','product_engagement','product_detail_opened','add_to_cart','checkout_started','upsell_shown','upsell_accepted'])await event(s1,name,product)
 await event(s1,'order_completed',product,o1,25.70);await event(s2,'product_detail_opened',product2);await event(s2,'order_completed',product2,o2,10);await event(s2,'order_cancelled',product2,o2)
 await event(sTest,'order_completed',product,o1,9999);await event(sPrevious,'product_impression',product);await event(sForeign,'order_completed',foreignProduct,oForeign,999)
 for(const entry of Object.values(ANALYTICS_SQL)){
  const source=await readFile(new URL(`../../supabase/migrations/${entry.source}`,import.meta.url),'utf8')
  const definition=source.match(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${entry.functionName}\\([\\s\\S]*?\\$\\$;`))?.[0]
  assert.ok(definition);await admin.query(definition)
 }
})
after(async()=>{await pool.end();await admin.end()})

async function reference(filter:AnalyticsWindow){
 const common=[a,filter.startedAt,filter.endedAt,filter.menuId,filter.locationId],result:Record<string,unknown>={}
 for(const [key,entry]of Object.entries(ANALYTICS_SQL)){
  const args=key==='attribution'?[a,filter.startedAt,filter.endedAt,filter.locationId]:key==='engagement'?[...common,'America/Sao_Paulo']:common
  const placeholders=args.map((_,index)=>`$${index+1}`).join(',')
  const sql=entry.table?`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) AS data FROM public.${entry.functionName}(${placeholders}) r`:`SELECT public.${entry.functionName}(${placeholders}) AS data`
  result[key]=(await admin.query(sql,args)).rows[0].data
 }
 return result
}

for(const [label,patch]of [['all',{}],['menu',{menuId:menu}],['location',{locationId:location}],['foreign menu',{menuId:foreignMenu}],['empty',{startedAt:'2026-11-01T00:00:00Z',endedAt:'2026-11-08T00:00:00Z',previousStartedAt:'2026-10-25T00:00:00Z'}]] as Array<[string,Partial<AnalyticsWindow>]>)test(`native aggregates equal original source RPC results: ${label}`,async()=>{
 const filter={...window,...patch},actual=await read(filter),expected=await reference(filter)
 assert.deepEqual(actual.overview,(expected.overview as unknown[])[0]);assert.deepEqual(actual.products,expected.products)
 assert.deepEqual(actual.upsell,expected.upsell);assert.deepEqual(actual.attribution,expected.attribution);assert.deepEqual(actual.engagement,expected.engagement)
 assert.deepEqual(actual.menus.map(row=>row.id),[menu,menu2]);assert.deepEqual(actual.locations.map(row=>row.id),[location]);assert.equal(actual.settings?.currency,null)
})

test('current/previous period and cancelled-plan gates retain their distinct meanings',async()=>{
 const data=await read();assert.equal((data.overview as {sessions:number}).sessions,2);assert.equal((data.previousOverview as {sessions:number}).sessions,1)
 assert.equal(data.capabilities.plan.payments,true);await admin.query("UPDATE public.tenant_subscriptions SET status='cancelled' WHERE tenant_id=$1",[a])
 try{assert.equal((await read()).capabilities.plan.payments,false)}finally{await admin.query("UPDATE public.tenant_subscriptions SET status='active' WHERE tenant_id=$1",[a])}
})

test('one repeatable-read snapshot includes metadata, periods and all six aggregate selections',async()=>{
 const before=await read();let inserted=false
 const frozen=await adminMenuTransaction(pool,false,async query=>{
  const wrapped:AdminMenuQuery=async(sql,values)=>{
   const result=await query(sql,values)
   if(!inserted&&sql===ANALYTICS_SQL.overview.sql){inserted=true;await admin.query("INSERT INTO public.menu_events(tenant_id,session_id,event_name,occurred_at,order_id,amount) VALUES($1,$2,'order_completed','2026-10-02T02:00Z',$3,5)",[a,s1,randomUUID()])}
   return result
  }
  return readAdminAnalytics(wrapped,context,window)
 })
 assert.deepEqual(frozen.overview,before.overview)
 const after=await read();assert.equal((after.overview as {revenue:number}).revenue,(before.overview as {revenue:number}).revenue+5)
})

test('native reads succeed with table SELECT privileges and no source RPC EXECUTE grants',async()=>{
 await admin.query(`CREATE ROLE xmart_analytics_read_probe NOLOGIN;
 GRANT USAGE ON SCHEMA public TO xmart_analytics_read_probe;
 GRANT SELECT ON public.tenant_settings,public.menus,public.locations,public.plans,public.tenant_subscriptions,public.products,public.orders,public.order_items,public.menu_sessions,public.menu_events TO xmart_analytics_read_probe`)
 try{
  for(const [key,entry]of Object.entries(ANALYTICS_SQL)){
   const args=key==='attribution'?'uuid,timestamptz,timestamptz,uuid':key==='engagement'?'uuid,timestamptz,timestamptz,uuid,uuid,text':'uuid,timestamptz,timestamptz,uuid,uuid'
   await admin.query(`REVOKE EXECUTE ON FUNCTION public.${entry.functionName}(${args}) FROM PUBLIC`)
  }
  await adminMenuTransaction(pool,false,async query=>{
   await query('SET LOCAL ROLE xmart_analytics_read_probe');await query('SAVEPOINT denied_source_rpc')
   await assert.rejects(query('SELECT public.get_menu_analytics_overview($1,$2,$3,$4,$5)',[a,window.startedAt,window.endedAt,null,null]),{code:'42501'})
   await query('ROLLBACK TO SAVEPOINT denied_source_rpc');await query('RELEASE SAVEPOINT denied_source_rpc')
   assert.equal((await readAdminAnalytics(query,context,window)).unavailable,false)
  })
 }finally{await admin.query('DROP OWNED BY xmart_analytics_read_probe; DROP ROLE xmart_analytics_read_probe')}
})
