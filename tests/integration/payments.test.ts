// Explicit disposable CI PostgreSQL only. Never dotenv, app startup or provider calls.
import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {OwnedPaymentRepository,type PaymentFacts} from '../../src/lib/data/payments'
import {createPaymentsPool,paymentTransaction} from '../../src/lib/data/payments-runtime'
const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable CI target required')
const url=new URL(raw)
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/xmartmenu_identity_test'||url.port!=='5432'||url.search||url.hash)throw Error('Not an isolated payment target')
const admin=new pg.Pool({connectionString:raw,max:2,statement_timeout:5000})
const pool=createPaymentsPool({NODE_ENV:'production',PROD_DATABASE_HOST:url.hostname,PROD_DATABASE_NAME:'xmartmenu_identity_test',PAYMENTS_DATABASE_URL:raw,PAYMENTS_DATABASE_SSL:'disable'})
const a=randomUUID(),b=randomUUID(),customer=randomUUID(),staff=randomUUID(),foreign=randomUUID(),menu=randomUUID(),session=randomUUID()
const run=<T>(write:boolean,operation:(repo:OwnedPaymentRepository)=>Promise<T>)=>paymentTransaction(pool,write,query=>operation(new OwnedPaymentRepository(query)))
async function order(patch:{tenant?:string;status?:string;currency?:string|null;intent?:string|null;total?:number;session?:boolean}={}){
 const id=randomUUID()
 await admin.query(`INSERT INTO public.orders(id,tenant_id,customer_id,status,total,tip_cents,currency,payment_intent_id,analytics_session_id)
 VALUES($1,$2,$3,$4,$5,200,$6,$7,$8)`,[id,patch.tenant??a,customer,patch.status??'awaiting_payment',patch.total??20,patch.currency??null,patch.intent??null,patch.session?session:null])
 return id
}
function facts(id:string,patch:Partial<PaymentFacts>={}):PaymentFacts{return{id:'pi_'+randomUUID().replaceAll('-',''),amount:2000,currency:'usd',metadata:{order_id:id,tenant_id:a},...patch}}
const event=(intent:PaymentFacts,id='evt_'+randomUUID().replaceAll('-',''))=>({id,type:'payment_intent.succeeded',data:{object:intent}})
before(async()=>{
 await admin.query(`DROP TABLE IF EXISTS public.processed_stripe_events,public.payment_divergences,public.menu_events,public.order_items,public.orders,
 public.menu_sessions,public.menus,public.locations,public.profiles,public.stripe_connections,public.tenant_subscriptions,public.plans,public.tenant_settings,public.tenants CASCADE;
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,is_active boolean DEFAULT true,slug text,name text);
 CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY,currency text);
 CREATE TABLE public.plans(id uuid PRIMARY KEY,features jsonb,transaction_fee_pct numeric);
 CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY,plan_id uuid,status text,override_transaction_fee_pct numeric);
 CREATE TABLE public.stripe_connections(tenant_id uuid,stripe_account_id text,is_active boolean);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid,role text);
 CREATE TABLE public.menus(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE public.locations(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE public.menu_sessions(id uuid PRIMARY KEY,tenant_id uuid,menu_id uuid,location_id uuid);
 CREATE TABLE public.orders(id uuid PRIMARY KEY,tenant_id uuid,customer_id uuid,status text,total numeric(10,2),tip_cents integer,currency text,payment_intent_id text,analytics_session_id uuid,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.order_items(id uuid PRIMARY KEY,order_id uuid,product_name text,quantity integer,unit_price numeric,selected_options jsonb);
 CREATE TABLE public.payment_divergences(order_id uuid,tenant_id uuid,payment_intent_id text,kind text,amount_minor bigint,currency text,details jsonb,UNIQUE(payment_intent_id,kind));
 CREATE TABLE public.processed_stripe_events(event_id text PRIMARY KEY,event_type text,processed_at timestamptz);
 CREATE TABLE public.menu_events(client_event_id uuid,server_event_key text UNIQUE,tenant_id uuid,session_id uuid,menu_id uuid,location_id uuid,order_id uuid,event_name text,occurred_at timestamptz,amount numeric,source text);`)
 await admin.query("INSERT INTO public.tenants VALUES($1,true,'fixture-a','Fixture A'),($2,true,'fixture-b','Fixture B')",[a,b])
 await admin.query("INSERT INTO public.tenant_settings VALUES($1,'usd'),($2,'jpy')",[a,b])
 const plan=randomUUID();await admin.query('INSERT INTO public.plans VALUES($1,$2,0.1)',[plan,JSON.stringify(['orders','payments','stripe-connect'])])
 await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,$3,'active',NULL),($2,$3,'active',0)",[a,b,plan])
 await admin.query("INSERT INTO public.stripe_connections VALUES($1,'acct_fixturea',true),($2,'acct_fixtureb',true)",[a,b])
 await admin.query("INSERT INTO public.profiles VALUES($1,NULL,'customer'),($2,$3,'store-staff'),($4,$5,'store-admin')",[customer,staff,a,foreign,b])
 await admin.query('INSERT INTO public.menus VALUES($1,$2)',[menu,a]);await admin.query('INSERT INTO public.menu_sessions(id,tenant_id,menu_id) VALUES($1,$2,$3)',[session,a,menu])
})
after(async()=>{await pool.end();await admin.end()})
test('selected configuration preserves NULL currency and zero fee, with exact tenant scope',async()=>{
 const id=await order({tenant:b});const s=await run(false,r=>r.snapshot(id,b));assert.equal(s.order.currency,null);assert.equal(s.config.currency,'jpy');assert.equal(s.config.fee,0)
 await assert.rejects(run(false,r=>r.snapshot(id,a)),{status:404})
 await admin.query("INSERT INTO public.stripe_connections VALUES($1,'acct_other',true)",[b])
 await assert.rejects(run(false,r=>r.configuration(b)),{status:503})
 await admin.query("DELETE FROM public.stripe_connections WHERE tenant_id=$1 AND stripe_account_id='acct_other'",[b])
})
test('authenticated order lookup preserves customer/member authority without foreign tenant leakage',async()=>{
 const id=await order();assert.ok(await run(false,r=>r.authorizedOrder(id,customer)));assert.ok(await run(false,r=>r.authorizedOrder(id,staff)))
 assert.equal(await run(false,r=>r.authorizedOrder(id,foreign)),null)
 await admin.query("UPDATE public.orders SET payment_intent_id='pi_current' WHERE id=$1",[id])
 await assert.rejects(run(false,r=>r.authorizedOrder(id,customer)),{status:403});assert.ok(await run(false,r=>r.authorizedOrder(id,staff)))
})
test('intent CAS permits one winner and refuses changed totals or cancelled state',async()=>{
 const id=await order(),s=await run(false,r=>r.snapshot(id,a))
 const claims=await Promise.all([run(true,r=>r.claim(s,'pi_one')),run(true,r=>r.claim(s,'pi_two'))]);assert.deepEqual(claims.sort(),[false,true])
 const changed=await order(),old=await run(false,r=>r.snapshot(changed,a));await admin.query('UPDATE public.orders SET total=21 WHERE id=$1',[changed]);assert.equal(await run(true,r=>r.claim(old,'pi_changed')),false)
 const cancelled=await order({status:'cancelled'}),cs=await run(false,r=>r.snapshot(cancelled,a));assert.equal(await run(true,r=>r.claim(cs,'pi_cancelled')),false)
})
test('concurrent matching provider events commit one status and one trusted analytics event',async()=>{
 const id=await order({session:true}),e=event(facts(id)),results=await Promise.all([run(true,r=>r.event(e)),run(true,r=>r.event(e))])
 assert.equal(results.filter(r=>'skipped'in r).length,1)
 assert.equal((await admin.query('SELECT status FROM public.orders WHERE id=$1',[id])).rows[0].status,'paid')
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events WHERE event_id=$1',[e.id])).rows[0].n,1)
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_events WHERE order_id=$1',[id])).rows[0].n,1)
})
test('ledger failure rolls back payment status and analytics, allowing the same event to retry',async()=>{
 const id=await order({session:true}),e=event(facts(id))
 await admin.query("ALTER TABLE public.processed_stripe_events ADD CONSTRAINT fixture_reject_event CHECK(event_id<>'"+e.id+"')")
 try{await assert.rejects(run(true,r=>r.event(e)),{status:503})}finally{await admin.query('ALTER TABLE public.processed_stripe_events DROP CONSTRAINT fixture_reject_event')}
 assert.equal((await admin.query('SELECT status FROM public.orders WHERE id=$1',[id])).rows[0].status,'awaiting_payment')
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.menu_events WHERE order_id=$1',[id])).rows[0].n,0)
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events WHERE event_id=$1',[e.id])).rows[0].n,0)
 assert.equal((await run(true,r=>r.event(e))).received,true)
})
test('mismatched tenant/currency/amount, stale failures and paid-after-cancel never regress kitchen/payment state',async()=>{
 const wrongTenant=await order();await run(true,r=>r.applySignal(facts(wrongTenant,{metadata:{order_id:wrongTenant,tenant_id:b}}),'succeeded'))
 const wrongCurrency=await order();await run(true,r=>r.applySignal(facts(wrongCurrency,{currency:'eur'}),'succeeded'))
 const underpaid=await order();await run(true,r=>r.applySignal(facts(underpaid,{amount:1999}),'succeeded'))
 for(const id of [wrongTenant,wrongCurrency,underpaid])assert.equal((await admin.query('SELECT status FROM public.orders WHERE id=$1',[id])).rows[0].status,'awaiting_payment')
 const cancelled=await order({status:'cancelled'});await run(true,r=>r.applySignal(facts(cancelled),'succeeded'));assert.equal((await admin.query('SELECT kind FROM public.payment_divergences WHERE order_id=$1',[cancelled])).rows[0].kind,'paid_after_cancel')
 const paid=await order({status:'preparing',intent:'pi_current'});assert.equal((await run(true,r=>r.applySignal(facts(paid,{id:'pi_stale'}),'failed'))).changed,false)
 await run(true,r=>r.applySignal(facts(paid,{id:'pi_other'}),'succeeded'));assert.equal((await admin.query('SELECT status FROM public.orders WHERE id=$1',[paid])).rows[0].status,'preparing')
 assert.equal((await admin.query('SELECT kind FROM public.payment_divergences WHERE order_id=$1',[paid])).rows[0].kind,'second_payment')
})
test('divergence failure cannot acknowledge an event without its audit evidence',async()=>{
 const id=await order(),e=event(facts(id,{amount:1}))
 await admin.query("ALTER TABLE public.payment_divergences ADD CONSTRAINT fixture_reject_divergence CHECK(kind<>'amount_below_total') NOT VALID")
 try{await assert.rejects(run(true,r=>r.event(e)),{status:503})}finally{await admin.query('ALTER TABLE public.payment_divergences DROP CONSTRAINT fixture_reject_divergence')}
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events WHERE event_id=$1',[e.id])).rows[0].n,0)
})
