// Disposable CI only. No dotenv, live Source, provider calls or applied DDL.
import { before,after,beforeEach,test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID,createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { adminMenuTransaction } from '../../src/lib/data/admin-menus-runtime'
import { createTenant,deleteTenant,updateTenant,mutatePlan,readPlans,readTenants,tenantSettings,readTenantMenuRows } from '../../src/lib/data/tenant-administration'
const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable tenant administration target required')
const selected=new URL(raw)
if(!['127.0.0.1','localhost'].includes(selected.hostname)||selected.pathname!=='/xmartmenu_identity_test'||selected.search||selected.hash)throw Error('Disposable tenant target required')
const target=new URL(selected);target.pathname='/xmartmenu'
const control=new pg.Pool({connectionString:raw,max:1}),admin=new pg.Pool({connectionString:target.href,max:2}),backend=new pg.Pool({connectionString:target.href,max:2,options:'-c role=xmartmenu_tenants_fixture -c default_transaction_read_only=on'})
const ids=Array.from({length:7},()=>randomUUID()),planId=randomUUID(),foreign=randomUUID(),hash=createHash('sha256').update('synthetic-session').digest('hex')
const context={actorId:ids[0],sessionHash:hash},input=(owner=ids[1],slug='new-shop')=>({name:'New shop',slug,owner_user_id:owner,plan_id:planId})
const write=<T>(operation:Parameters<typeof adminMenuTransaction<T>>[2])=>adminMenuTransaction(backend,true,operation)
const read=<T>(operation:Parameters<typeof adminMenuTransaction<T>>[2])=>adminMenuTransaction(backend,false,operation)
const snapshot=async(table:string)=>(await admin.query(`SELECT to_jsonb(r) AS row FROM public.${table} r ORDER BY to_jsonb(r)::text`)).rows
let created=false,roleCreated=false
before(async()=>{
 assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0)
 await control.query('CREATE DATABASE xmartmenu');created=true
 await control.query('CREATE ROLE xmartmenu_tenants_fixture NOLOGIN BYPASSRLS');roleCreated=true
 await admin.query(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text UNIQUE NOT NULL,plan text,is_active boolean DEFAULT true,created_at timestamptz DEFAULT now(),custom_domain text,xphere_account_id text,xphere_contact_id text,xphere_opportunity_id text);
 CREATE TABLE profiles(id uuid PRIMARY KEY,role text,tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,full_name text,must_change_password boolean DEFAULT false,created_at timestamptz DEFAULT now());
 CREATE TABLE app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz,session_version int NOT NULL DEFAULT 0);
 CREATE TABLE app_identity_bindings(project_id text,subject text,user_id uuid REFERENCES app_accounts(id),provider text,disabled_at timestamptz,PRIMARY KEY(project_id,subject));
 CREATE TABLE app_sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES app_accounts(id),session_version int,authenticated_at timestamptz,expires_at timestamptz,project_id text,subject text);
 CREATE TABLE plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,slug text UNIQUE,description text,monthly_price numeric(10,2),annual_price numeric(10,2),transaction_fee_pct numeric(5,4),features jsonb DEFAULT '[]',is_active boolean DEFAULT true,sort_order int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),stripe_product_id text,stripe_price_monthly_id text,stripe_price_annual_id text);
 CREATE TABLE tenant_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,logo_url text,business_type text,orders_enabled boolean DEFAULT false,direct_orders_enabled boolean DEFAULT false,dine_in_enabled boolean DEFAULT false,table_management_enabled boolean DEFAULT false,tips_enabled boolean DEFAULT false,delivery_enabled boolean DEFAULT false,upsell_enabled boolean DEFAULT false,amber_threshold_minutes int DEFAULT 5,red_threshold_minutes int DEFAULT 10,primary_color text,custom_tags text[],business_hours jsonb);
 CREATE TABLE tenant_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,plan_id uuid REFERENCES plans(id) ON DELETE RESTRICT,billing_cycle text,status text,stripe_subscription_id text,stripe_customer_id text,current_period_end timestamptz,override_monthly_price numeric,override_annual_price numeric,override_transaction_fee_pct numeric,override_notes text);
 CREATE TABLE menus(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,name text,slug text,language text,supported_languages text[],purpose text,is_active boolean,is_default boolean,position int,created_at timestamptz DEFAULT now());
 CREATE TABLE categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,menu_id uuid REFERENCES menus(id) ON DELETE CASCADE,name text,position int);
 CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,menu_id uuid REFERENCES menus(id) ON DELETE CASCADE,category_id uuid REFERENCES categories(id),name text,position int);
 CREATE TABLE audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid,actor_id uuid,via text,table_name text,record_id text,action text,changes jsonb);
 CREATE TABLE historical_finance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,amount int);`)
 await admin.query(await readFile(new URL('../../docs/proposals/native-tenant-effects-owned-only.sql',import.meta.url),'utf8'))
 for(const id of ids)await admin.query('INSERT INTO auth.users VALUES($1)',[id])
 await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_tenants_fixture;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_tenants_fixture;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO xmartmenu_tenants_fixture')
})
beforeEach(async()=>{
 await admin.query('TRUNCATE profiles,app_accounts,tenants,plans CASCADE;TRUNCATE audit_events')
 await admin.query("INSERT INTO plans(id,name,slug,monthly_price,annual_price,transaction_fee_pct,features) VALUES($1,'Menu','menu',10,100,0.015,'[\"orders\"]')",[planId])
 await admin.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Foreign','foreign')",[foreign])
 for(const [index,id] of ids.entries()){
  await admin.query('INSERT INTO app_accounts(id,disabled_at) VALUES($1,$2)',[id,index===5?new Date('2026-01-01'):null])
  await admin.query('INSERT INTO profiles(id,role,tenant_id,must_change_password) VALUES($1,$2,$3,$4)',[id,index===0?'superadmin':index===3?'store-admin':'customer',index===3?foreign:null,index===6])
  await admin.query("INSERT INTO app_identity_bindings VALUES('skaleclub',$1,$2,'google.com',NULL)",[`subject-${index}`,id])
  await admin.query("INSERT INTO app_sessions VALUES($1,$2,0,now(),now()+interval '1 hour','skaleclub',$3)",[index===0?hash:createHash('sha256').update(id).digest('hex'),id,`subject-${index}`])
 }
})
after(async()=>{await backend.end();await admin.end();if(created)await control.query('DROP DATABASE xmartmenu');if(roleCreated)await control.query('DROP ROLE xmartmenu_tenants_fixture');await control.end()})
test('atomic explicit verified UID creates intended restaurant shape, revokes owner sessions and preserves all seven identities',async()=>{
 const providers=await snapshot('app_identity_bindings'),before=(await admin.query('SELECT * FROM auth.users ORDER BY id')).rows
 const result=await write(q=>createTenant(q,context,input()))
 assert.equal(result.owner_id,ids[1]);assert.equal('credentials' in result,false);assert.equal(result.externalSync,'pending-native-dispatch')
 const id=String(result.tenant.id)
 assert.deepEqual((await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[ids[1]])).rows[0],{role:'store-admin',tenant_id:id})
 assert.equal((await admin.query('SELECT count(*)::int n FROM app_sessions WHERE user_id=$1',[ids[1]])).rows[0].n,0)
 assert.equal((await admin.query('SELECT session_version FROM app_accounts WHERE id=$1',[ids[1]])).rows[0].session_version,1)
 assert.equal((await admin.query('SELECT count(*)::int n FROM menus WHERE tenant_id=$1 AND is_default AND is_active',[id])).rows[0].n,1)
 assert.deepEqual((await admin.query('SELECT orders_enabled,table_management_enabled,direct_orders_enabled FROM tenant_settings WHERE tenant_id=$1',[id])).rows[0],{orders_enabled:true,table_management_enabled:true,direct_orders_enabled:false})
 assert.equal((await admin.query('SELECT status FROM app_tenant_effects WHERE tenant_id=$1',[id])).rows[0].status,'pending')
 assert.equal((await snapshot('app_accounts')).length,7);assert.deepEqual(await snapshot('app_identity_bindings'),providers);assert.deepEqual((await admin.query('SELECT * FROM auth.users ORDER BY id')).rows,before)
 await assert.rejects(backend.query('SELECT * FROM auth.users'),{code:'42501'})
})
test('no contact linking, role/tenant/ID injection or reassignment of disabled, recovery, assigned or unverified accounts',async()=>{
 for(const owner of [ids[0],ids[3],ids[5],ids[6]])await assert.rejects(write(q=>createTenant(q,context,input(owner))))
 await admin.query('UPDATE app_identity_bindings SET disabled_at=now() WHERE user_id=$1',[ids[1]])
 await assert.rejects(write(q=>createTenant(q,context,input())),{status:409})
 await assert.rejects(write(q=>createTenant(q,context,{...input(),email:'someone@example.test'})),{status:400})
 await assert.rejects(write(q=>createTenant(q,context,{...input(),role:'superadmin',tenant_id:foreign})),{status:400})
 assert.equal((await snapshot('tenants')).length,1);assert.equal((await snapshot('audit_events')).length,0)
})
test('same owner and slug concurrent creations serialize: exactly one complete restaurant, no orphan rows',async()=>{
 const results=await Promise.allSettled([write(q=>createTenant(q,context,input())),write(q=>createTenant(q,context,input()))])
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1)
 for(const table of ['tenant_settings','menus','tenant_subscriptions','app_tenant_effects','audit_events'])assert.equal((await snapshot(table)).length,1)
})
test('audit failure rolls back every ownership, version, settings, menu, subscription and outbox change',async()=>{
 const profiles=await snapshot('profiles'),accounts=await snapshot('app_accounts'),sessions=await snapshot('app_sessions')
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT reject_audit CHECK(false) NOT VALID')
 try{await assert.rejects(write(q=>createTenant(q,context,input())),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT reject_audit')}
 assert.deepEqual(await snapshot('profiles'),profiles);assert.deepEqual(await snapshot('app_accounts'),accounts);assert.deepEqual(await snapshot('app_sessions'),sessions)
 assert.equal((await snapshot('tenants')).length,1)
 for(const table of ['menus','tenant_settings','tenant_subscriptions','app_tenant_effects'])assert.equal((await snapshot(table)).length,0)
})
test('post-provider SQL role/version/disabled/recovery/expiry state refuses the next request without a legacy read',async()=>{
 for(const sql of ["UPDATE profiles SET role='customer' WHERE id=$1",'UPDATE app_accounts SET disabled_at=now() WHERE id=$1','UPDATE profiles SET must_change_password=true WHERE id=$1','UPDATE app_accounts SET session_version=1 WHERE id=$1','UPDATE app_sessions SET expires_at=now() WHERE user_id=$1','UPDATE app_identity_bindings SET disabled_at=now() WHERE user_id=$1']){
  await admin.query(sql,[ids[0]]);await assert.rejects(read(q=>readTenants(q,context)),{status:403});await assert.rejects(write(q=>createTenant(q,context,input())),{status:403})
  await admin.query("UPDATE profiles SET role='superadmin',must_change_password=false WHERE id=$1;",[ids[0]])
  await admin.query('UPDATE app_accounts SET disabled_at=NULL,session_version=0 WHERE id=$1',[ids[0]])
  await admin.query("UPDATE app_sessions SET expires_at=now()+interval '1 hour' WHERE user_id=$1",[ids[0]])
  await admin.query('UPDATE app_identity_bindings SET disabled_at=NULL WHERE user_id=$1',[ids[0]])
 }
})
test('plan CRUD returns numbers, preserves Stripe IDs, validates final prices and protects billing references',async()=>{
 const plan=await write(q=>mutatePlan(q,context,'create',undefined,{name:'Custom',monthly_price:20,annual_price:200,features:[]}))
 assert.equal(typeof plan?.monthly_price,'number')
 const id=String(plan?.id);await admin.query("UPDATE plans SET stripe_price_monthly_id='price_synthetic' WHERE id=$1",[id])
 await write(q=>mutatePlan(q,context,'update',id,{name:'Custom revised',is_active:false}))
 assert.equal((await admin.query('SELECT stripe_price_monthly_id FROM plans WHERE id=$1',[id])).rows[0].stripe_price_monthly_id,'price_synthetic')
 await assert.rejects(write(q=>mutatePlan(q,context,'update',id,{monthly_price:201})),{status:400})
 await assert.rejects(write(q=>mutatePlan(q,context,'delete',id)),{status:409})
 await admin.query('UPDATE plans SET stripe_price_monthly_id=NULL WHERE id=$1',[id]);await write(q=>mutatePlan(q,context,'delete',id))
 await assert.rejects(read(q=>readPlans(q,context,id)),{status:404})
 await write(q=>createTenant(q,context,input()));await assert.rejects(write(q=>mutatePlan(q,context,'delete',planId)),{status:409})
})
test('tenant/menu/category readers enforce both tenant and menu, settings enforce actual live plan and validated types',async()=>{
 const result=await write(q=>createTenant(q,context,input())),id=String(result.tenant.id),menu=(await admin.query('SELECT id FROM menus WHERE tenant_id=$1',[id])).rows[0].id
 const category=randomUUID();await admin.query("INSERT INTO categories(id,tenant_id,menu_id,name,position) VALUES($1,$2,$3,'Category',0)",[category,id,menu])
 await assert.rejects(read(q=>readTenantMenuRows(q,context,foreign,menu,'categories')),{status:404})
 await assert.rejects(read(q=>readTenantMenuRows(q,context,id,menu,'products',randomUUID())),{status:404})
 assert.deepEqual(await read(q=>readTenantMenuRows(q,context,id,menu,'categories')),{categories:[{id:category,name:'Category'}]})
 await assert.rejects(write(q=>tenantSettings(q,context,id,{direct_orders_enabled:true})),{status:403})
 await assert.rejects(write(q=>tenantSettings(q,context,id,{tenant_id:foreign})),{status:400})
 await assert.rejects(write(q=>tenantSettings(q,context,id,{primary_color:'red;script'})),{status:400})
 await assert.rejects(write(q=>tenantSettings(q,context,id,{amber_threshold_minutes:11})),{status:400})
 await write(q=>tenantSettings(q,context,id,{custom_tags:['Fresh'],business_hours:{monday:'closed'},table_management_enabled:false}))
 assert.deepEqual((await admin.query('SELECT custom_tags,business_hours FROM tenant_settings WHERE tenant_id=$1',[id])).rows[0],{custom_tags:['Fresh'],business_hours:{monday:'closed'}})
})
test('delete removes only empty local shell, preserves users/provider UUIDs and audit, cancels pending outbox; archive remains functional',async()=>{
 const result=await write(q=>createTenant(q,context,input())),id=String(result.tenant.id),providers=await snapshot('app_identity_bindings')
 const deleted=await write(q=>deleteTenant(q,context,id));assert.equal(deleted.deleted,true)
 assert.deepEqual((await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[ids[1]])).rows[0],{role:'customer',tenant_id:null})
 assert.equal((await snapshot('app_accounts')).length,7);assert.deepEqual(await snapshot('app_identity_bindings'),providers)
 assert.equal((await admin.query('SELECT status,tenant_id FROM app_tenant_effects')).rows[0].status,'cancelled');assert.equal((await snapshot('audit_events')).length,2)
 await write(q=>updateTenant(q,context,foreign,{is_active:false}));assert.equal((await admin.query('SELECT is_active FROM tenants WHERE id=$1',[foreign])).rows[0].is_active,false)
})
test('unknown financial FK, menu content, Stripe or domain dependency prevents cascade; mandatory audit failure prevents delete',async()=>{
 const result=await write(q=>createTenant(q,context,input())),id=String(result.tenant.id)
 await admin.query('INSERT INTO historical_finance(tenant_id,amount) VALUES($1,123)',[id]);await assert.rejects(write(q=>deleteTenant(q,context,id)),{status:409})
 await admin.query('DELETE FROM historical_finance');await admin.query("UPDATE tenants SET custom_domain='synthetic.invalid' WHERE id=$1",[id]);await assert.rejects(write(q=>deleteTenant(q,context,id)),{status:409})
 await admin.query('UPDATE tenants SET custom_domain=NULL WHERE id=$1',[id]);await admin.query("UPDATE tenant_subscriptions SET stripe_subscription_id='sub_synthetic' WHERE tenant_id=$1",[id]);await assert.rejects(write(q=>deleteTenant(q,context,id)),{status:409})
 await admin.query('UPDATE tenant_subscriptions SET stripe_subscription_id=NULL WHERE tenant_id=$1',[id]);await admin.query('ALTER TABLE audit_events ADD CONSTRAINT reject_audit CHECK(false) NOT VALID')
 const users=await snapshot('profiles'),accounts=await snapshot('app_accounts')
 try{await assert.rejects(write(q=>deleteTenant(q,context,id)),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT reject_audit')}
 assert.deepEqual(await snapshot('profiles'),users);assert.deepEqual(await snapshot('app_accounts'),accounts);assert.equal((await admin.query('SELECT status FROM app_tenant_effects WHERE tenant_id=$1',[id])).rows[0].status,'pending')
})

test('delete metadata lock permits an existing tenant-first financial transaction to finish its settings write without lock inversion',async()=>{
 const result=await write(q=>createTenant(q,context,input())),id=String(result.tenant.id),blocker=await admin.connect()
 let reached=()=>{};const metadataLocked=new Promise<void>(resolve=>{reached=resolve})
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM tenants WHERE id=$1 FOR NO KEY UPDATE',[id])
  const deleting=write(q=>deleteTenant(async(sql,values)=>{const result=await q(sql,values);if(sql.startsWith('LOCK TABLE'))reached();return result},context,id))
  await metadataLocked
  await blocker.query('UPDATE tenant_settings SET orders_enabled=false WHERE tenant_id=$1',[id]);await blocker.query('COMMIT')
  assert.equal((await deleting).deleted,true)
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release()}
})
