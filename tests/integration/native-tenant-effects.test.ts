// Disposable CI only: no dotenv, real provider, Source connection or live DDL.
import {before,after,beforeEach,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {adminMenuTransaction} from '../../src/lib/data/admin-menus-runtime'
import {reserveTenantOperation,claimTenantOperation,finishTenantOperation,tenantEffectByteDigest} from '../../src/lib/data/tenant-effect-operations'
import {readTenantEffectCatalog,applyTenantEffectSeed,applyTenantEffectImage} from '../../src/lib/data/tenant-effect-catalog'
import {prepareTenantEffectCall,recordTenantEffectCall,reconcileTenantEffectCall} from '../../src/lib/data/tenant-effect-calls'
import {prepareNativeImageStep,advanceNativeImageStep} from '../../src/lib/data/tenant-effect-image-jobs'
import {prepareNativeUploadTicket,nativeOperationStatus,consumeNativeOcrTicket} from '../../src/lib/data/tenant-effect-uploads'
import {enqueueNativeTenantEffect} from '../../src/lib/data/tenant-effects-outbox'
import {enqueueNativeTenantEffectBatch} from '../../src/lib/data/tenant-effects-backfill'
import {nativeOnboarding} from '../../src/lib/auth/native-onboarding'
import {readNativeCrmFacts,claimNativeCrmEffect,completeNativeCrmEffect,reconcileNativeCrmEffect} from '../../src/lib/data/native-crm-effects'
import {applySaasWebhook} from '../../src/lib/data/saas-webhooks'
import {claimNativeStripeOAuth,completeNativeStripeOAuth,disconnectNativeStripe} from '../../src/lib/data/stripe-connect'
import type {TenantEffectActor} from '../../src/lib/data/tenant-effect-authority'
const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable tenant effects target required')
const selected=new URL(raw)
if(!['127.0.0.1','localhost'].includes(selected.hostname)||selected.pathname!=='/xmartmenu_identity_test'||selected.search||selected.hash)throw Error('Disposable tenant effects target required')
const target=new URL(selected);target.pathname='/xmartmenu'
const control=new pg.Pool({connectionString:raw,max:1}),admin=new pg.Pool({connectionString:target.href,max:2,options:'-c role=xmartmenu_owner'}),backend=new pg.Pool({connectionString:target.href,max:2,options:'-c role=xmartmenu_effects_fixture -c default_transaction_read_only=on'})
const ids=Array.from({length:7},()=>randomUUID()),tenant=randomUUID(),foreign=randomUUID(),menu=randomUUID(),otherMenu=randomUUID(),category=randomUUID(),product=randomUUID(),plan=randomUUID()
const hashes=ids.map(id=>createHash('sha256').update('offline-session-'+id).digest('hex'))
let created=false,ownerCreated=false,backendCreated=false,authenticatedAt=0
const oldFlag=process.env.OWNED_TENANT_EFFECTS_ENABLED
const proof=(index=0):TenantEffectActor=>({actorId:ids[index],sessionHash:hashes[index],projectId:'skaleclub',subject:`subject-${index}`,authenticatedAt,checkedAt:Date.now()})
const tx=<T>(operation:Parameters<typeof adminMenuTransaction<T>>[2])=>adminMenuTransaction(backend,true,operation)
const read=<T>(operation:Parameters<typeof adminMenuTransaction<T>>[2])=>adminMenuTransaction(backend,false,operation)
const rows=async(table:string)=>(await admin.query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`)).rows
before(async()=>{
 assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0)
 await control.query('CREATE ROLE xmartmenu_owner NOLOGIN');ownerCreated=true
 await control.query('CREATE ROLE xmartmenu_effects_fixture NOLOGIN BYPASSRLS');backendCreated=true
 await control.query('CREATE DATABASE xmartmenu OWNER xmartmenu_owner');created=true
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
 CREATE TABLE categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,menu_id uuid REFERENCES menus(id) ON DELETE CASCADE,name text,description text,translations jsonb DEFAULT '{}',is_active boolean DEFAULT true,position int);
 CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,menu_id uuid REFERENCES menus(id) ON DELETE CASCADE,category_id uuid REFERENCES categories(id),name text,description text,translations jsonb DEFAULT '{}',price numeric,image_url text,is_available boolean,is_featured boolean,tags text[],image_urls text[],position int);
 CREATE TABLE audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid,actor_id uuid,via text,table_name text,record_id text,action text,changes jsonb);
 CREATE TABLE historical_finance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,amount int);`)
 await admin.query(`ALTER TABLE tenants ADD COLUMN xphere_synced_at timestamptz,ADD COLUMN xphere_sync_error text;
 ALTER TABLE profiles ADD COLUMN phone text;
 ALTER TABLE tenant_settings ADD COLUMN phone text,ADD COLUMN address text,ADD COLUMN accent_color text;
 ALTER TABLE tenant_settings ADD COLUMN banner_url text,ADD COLUMN tagline text,ADD COLUMN about text,ADD COLUMN currency text;
 ALTER TABLE tenant_subscriptions ADD COLUMN current_period_start timestamptz,ADD COLUMN cancel_at_period_end boolean DEFAULT false,ADD COLUMN chat_addon_active boolean DEFAULT false,ADD COLUMN chat_addon_since timestamptz;
 ALTER TABLE tenant_settings ADD COLUMN whatsapp_orders_enabled boolean DEFAULT false,ADD COLUMN whatsapp text,ADD COLUMN item_notes_enabled boolean DEFAULT false,ADD COLUMN ingredient_customization_enabled boolean DEFAULT false,ADD COLUMN pickup_enabled boolean DEFAULT false,ADD COLUMN delivery_fee_cents int,ADD COLUMN pickup_eta_minutes int;
 CREATE TABLE stripe_connections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES tenants(id),stripe_account_id text,scope text DEFAULT 'read_write',is_active boolean DEFAULT true,connected_at timestamptz,disconnected_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE processed_stripe_events(event_id text PRIMARY KEY,event_type text,processed_at timestamptz);
 CREATE TABLE ai_usage_events(id bigserial PRIMARY KEY,tenant_id uuid,feature text,model text,key_source text,billable boolean,cost_usd numeric,markup_pct numeric,charge_usd numeric,generation_id text,request_id text,invoiced_at timestamptz,occurred_at timestamptz DEFAULT now(),billing_batch uuid);
 CREATE TABLE ai_usage(tenant_id uuid,feature_key text,date date,call_count int,token_count bigint,UNIQUE(tenant_id,feature_key,date));
 CREATE TABLE chat_addon_settings(tenant_id uuid PRIMARY KEY,enabled boolean);`)
 for(const path of ['native-tenant-effects-owned-only.sql','native-tenant-effects-dispatch-owned-only.sql','native-tenant-operations-owned-only.sql'])await admin.query(await readFile(new URL('../../docs/proposals/'+path,import.meta.url),'utf8'))
 const oauth=await readFile(new URL('../../docs/proposals/native-stripe-oauth-owned-only.sql',import.meta.url),'utf8')
 await admin.query(oauth.slice(oauth.indexOf('CREATE TABLE public.app_stripe_oauth_attempts'),oauth.indexOf('REVOKE ALL ON')))
 const onboarding=await readFile(new URL('../../supabase/migrations/20261027096000_atomic_onboarding.sql',import.meta.url),'utf8')
 await admin.query(onboarding.slice(0,onboarding.indexOf('REVOKE EXECUTE')))
 for(const id of ids)await admin.query('INSERT INTO auth.users VALUES($1)',[id])
 await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_effects_fixture;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_effects_fixture;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO xmartmenu_effects_fixture')
 process.env.OWNED_TENANT_EFFECTS_ENABLED='true'
})
beforeEach(async()=>{
 await admin.query('TRUNCATE profiles,app_accounts,tenants,plans CASCADE;TRUNCATE audit_events,processed_stripe_events,ai_usage_events,ai_usage,chat_addon_settings')
 await admin.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Synthetic shop','synthetic-shop'),($2,'Other shop','other-shop')",[tenant,foreign])
 await admin.query("INSERT INTO plans(id,name,slug,monthly_price,annual_price,transaction_fee_pct,features) VALUES($1,'Payments','payments',30,300,0.015,'[\"payments\",\"stripe-connect\"]')",[plan])
 await admin.query("INSERT INTO tenant_subscriptions(tenant_id,plan_id,billing_cycle,status,stripe_subscription_id) VALUES($1,$3,'monthly','active','sub_synthetic'),($2,$3,'monthly','active','sub_other')",[tenant,foreign,plan])
 await admin.query("INSERT INTO tenant_settings(tenant_id,business_type,currency) VALUES($1,'Restaurant','BRL'),($2,'Cafe','BRL')",[tenant,foreign])
 await admin.query("INSERT INTO menus(id,tenant_id,name,slug,language,supported_languages,is_active,is_default,position) VALUES($1,$2,'Main','main','en',ARRAY['en','pt'],true,true,0),($3,$4,'Other','other','en',ARRAY['en'],true,true,0)",[menu,tenant,otherMenu,foreign])
 await admin.query("INSERT INTO categories(id,tenant_id,menu_id,name,position) VALUES($1,$2,$3,'Existing',0)",[category,tenant,menu])
 await admin.query("INSERT INTO products(id,tenant_id,menu_id,category_id,name,description,price,position) VALUES($1,$2,$3,$4,'Existing item','Original',12,0)",[product,tenant,menu,category])
 authenticatedAt=Math.floor(Date.now()/1000)
 for(const [index,id] of ids.entries()){
  await admin.query('INSERT INTO app_accounts(id,disabled_at) VALUES($1,$2)',[id,index===5?new Date('2026-01-01'):null])
  await admin.query('INSERT INTO profiles(id,role,tenant_id,must_change_password) VALUES($1,$2,$3,$4)',[id,index===0||index===4?'superadmin':index===1||index===5?'store-admin':index===3||index===6?'store-staff':'customer',[1,3,5,6].includes(index)?tenant:null,index===6])
  await admin.query("INSERT INTO app_identity_bindings VALUES('skaleclub',$1,$2,'google.com',NULL)",[`subject-${index}`,id])
  await admin.query("INSERT INTO app_sessions(token_hash,user_id,session_version,authenticated_at,expires_at,project_id,subject) VALUES($1,$2,0,$3,clock_timestamp()+interval '1 day','skaleclub',$4)",[hashes[index],id,new Date(authenticatedAt*1000),`subject-${index}`])
 }
})
after(async()=>{if(oldFlag===undefined)delete process.env.OWNED_TENANT_EFFECTS_ENABLED;else process.env.OWNED_TENANT_EFFECTS_ENABLED=oldFlag;await backend.end();await admin.end();if(created)await control.query('DROP DATABASE xmartmenu');if(backendCreated)await control.query('DROP ROLE xmartmenu_effects_fixture');if(ownerCreated)await control.query('DROP ROLE xmartmenu_owner');await control.end()})

const seedInput={type:'menu',menuId:menu,businessType:'Restaurant',companyName:'Synthetic'}
const reserve=(kind:'seed'|'image-job'|'ocr'|'ocr-upload'='seed',input:Record<string,unknown>=seedInput,key=randomUUID())=>tx(q=>reserveTenantOperation(q,proof(),tenant,kind,key,input))
const receipt=(feature:'seed'|'seed_image'|'storage'='seed')=>({feature,model:feature==='storage'?null:'synthetic/model',generationId:feature==='storage'?null:'synthetic-'+randomUUID(),costUsd:feature==='storage'?null:0.125,tokens:feature==='storage'?0:42,responseDigest:'b'.repeat(64)})
test('same exact operation replay has one row/audit; body/session/role injection cannot grant another operation',async()=>{
 const key=randomUUID(),results=await Promise.all([reserve('seed',seedInput,key),reserve('seed',seedInput,key)])
 assert.equal(results[0].id,results[1].id);assert.equal((await rows('app_tenant_operations')).length,1);assert.equal((await rows('audit_events')).length,1)
 await assert.rejects(reserve('seed',{...seedInput,type:'products'},key),{status:409})
 await assert.rejects(tx(q=>reserveTenantOperation(q,{...proof(),sessionHash:'superadmin'},tenant,'seed',randomUUID(),seedInput)),{status:403})
 await assert.rejects(tx(q=>reserveTenantOperation(q,proof(3),tenant,'seed',randomUUID(),seedInput)),{status:403})
 await assert.rejects(backend.query('SELECT * FROM auth.users'),{code:'42501'})
})
test('stale provider observation and current session expiry/version/binding/role/recovery/disabled state deny every new SQL phase',async()=>{
 const op=await reserve()
 await assert.rejects(tx(q=>claimTenantOperation(q,{...proof(),checkedAt:Date.now()-5001},op.id,'a'.repeat(64))),{status:403})
 for(const change of ["UPDATE profiles SET role='customer' WHERE id=$1",'UPDATE app_accounts SET disabled_at=clock_timestamp() WHERE id=$1','UPDATE app_accounts SET session_version=1 WHERE id=$1','UPDATE app_sessions SET expires_at=clock_timestamp() WHERE user_id=$1','UPDATE app_identity_bindings SET disabled_at=clock_timestamp() WHERE user_id=$1','UPDATE profiles SET must_change_password=true WHERE id=$1']){
  await admin.query(change,[ids[0]])
  await assert.rejects(tx(q=>claimTenantOperation(q,proof(),op.id,'a'.repeat(64))),{status:403})
  await admin.query("UPDATE profiles SET role='superadmin',must_change_password=false WHERE id=$1",[ids[0]])
  await admin.query('UPDATE app_accounts SET disabled_at=NULL,session_version=0 WHERE id=$1',[ids[0]])
  await admin.query("UPDATE app_sessions SET expires_at=clock_timestamp()+interval '1 day' WHERE user_id=$1",[ids[0]])
  await admin.query('UPDATE app_identity_bindings SET disabled_at=NULL WHERE user_id=$1',[ids[0]])
 }
 assert.equal((await admin.query('SELECT status FROM app_tenant_operations WHERE id=$1',[op.id])).rows[0].status,'reserved')
})
test('one claim and one paid receipt survive duplicate delivery without another usage row or fabricated charge',async()=>{
 const op=await reserve(),snapshot=await read(q=>readTenantEffectCatalog(q,proof(),tenant,menu))
 const outcomes=await Promise.allSettled([tx(q=>claimTenantOperation(q,proof(),op.id,snapshot.digest)),tx(q=>claimTenantOperation(q,proof(),op.id,snapshot.digest))])
 assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1)
 const claimed=outcomes.find(row=>row.status==='fulfilled');assert.ok(claimed&&claimed.status==='fulfilled'&&claimed.value.claimId)
 const claimId=claimed.value.claimId
 await tx(q=>prepareTenantEffectCall(q,proof(),op.id,claimId,0,'seed',{model:'synthetic'}))
 await assert.rejects(tx(q=>prepareTenantEffectCall(q,proof(),op.id,claimId,0,'seed',{model:'synthetic'})),{status:409})
 const fact=receipt();await tx(q=>recordTenantEffectCall(q,op.id,claimId,0,fact));await tx(q=>recordTenantEffectCall(q,op.id,claimId,0,fact))
 assert.equal((await rows('ai_usage_events')).length,1)
 assert.deepEqual((await admin.query('SELECT billable,cost_usd::float8 cost,charge_usd::float8 charge FROM ai_usage_events')).rows,[{billable:false,cost:0.125,charge:0}])
 assert.equal((await admin.query('SELECT call_count FROM ai_usage')).rows[0].call_count,1)
 await assert.rejects(tx(q=>recordTenantEffectCall(q,op.id,claimId,0,{...fact,responseDigest:'c'.repeat(64)})),{status:409})
})
test('revocation after provider success preserves its cost fact but prevents catalog apply and session authority reuse',async()=>{
 const op=await reserve(),snapshot=await read(q=>readTenantEffectCatalog(q,proof(),tenant,menu)),claimed=await tx(q=>claimTenantOperation(q,proof(),op.id,snapshot.digest));assert.ok(claimed.claimId)
 const claimId=claimed.claimId
 await tx(q=>prepareTenantEffectCall(q,proof(),op.id,claimId,0,'seed',{}))
 await admin.query('UPDATE app_accounts SET session_version=1 WHERE id=$1',[ids[0]])
 await tx(q=>recordTenantEffectCall(q,op.id,claimId,0,receipt()))
 await assert.rejects(tx(async q=>{await applyTenantEffectSeed(q,proof(),snapshot,'menu',[{name:'New',products:[]}]);await finishTenantOperation(q,proof(),op.id,claimId,{success:true})}),{status:403})
 await tx(q=>reconcileTenantEffectCall(q,op.id,claimId,0))
 assert.equal((await rows('ai_usage_events')).length,1);assert.equal((await rows('categories')).length,1)
 assert.equal((await admin.query('SELECT status FROM app_tenant_operations WHERE id=$1',[op.id])).rows[0].status,'reconcile')
})
test('native additive catalog semantics preserve IDs, existing names and translations, with atomic mandatory audit',async()=>{
 const original=await rows('auth.users'),bindings=await rows('app_identity_bindings'),disabled=(await admin.query('SELECT disabled_at FROM app_accounts WHERE id=$1',[ids[5]])).rows
 const op=await reserve(),snapshot=await read(q=>readTenantEffectCatalog(q,proof(),tenant,menu)),claimed=await tx(q=>claimTenantOperation(q,proof(),op.id,snapshot.digest));assert.ok(claimed.claimId)
 const claimId=claimed.claimId
 const result=await tx(async q=>{const result=await applyTenantEffectSeed(q,proof(),snapshot,'menu',[{name:'Existing',products:[{name:'Ignored',price:1}]},{name:'New category',translations:{pt:{name:'Nova'},xx:{name:'Invalid'}},products:[{name:'New item',price:0},{name:'new ITEM',price:4}]}]);await finishTenantOperation(q,proof(),op.id,claimId,result);return result})
 assert.deepEqual(result,{success:true,categoriesCreated:1,productsCreated:1})
 assert.deepEqual((await admin.query("SELECT translations FROM categories WHERE name='New category'")).rows[0].translations,{pt:{name:'Nova'}})
 assert.equal((await admin.query('SELECT count(*)::int n FROM app_accounts')).rows[0].n,7)
 assert.deepEqual(await rows('auth.users'),original);assert.deepEqual(await rows('app_identity_bindings'),bindings);assert.deepEqual((await admin.query('SELECT disabled_at FROM app_accounts WHERE id=$1',[ids[5]])).rows,disabled)
 assert.equal((await admin.query('SELECT name FROM products WHERE id=$1',[product])).rows[0].name,'Existing item')
})
test('audit failure rolls back generated categories/products and applied result together without retrying the paid receipt',async()=>{
 const op=await reserve(),snapshot=await read(q=>readTenantEffectCatalog(q,proof(),tenant,menu)),claimed=await tx(q=>claimTenantOperation(q,proof(),op.id,snapshot.digest));assert.ok(claimed.claimId);const claimId=claimed.claimId
 await tx(q=>prepareTenantEffectCall(q,proof(),op.id,claimId,0,'seed',{}));await tx(q=>recordTenantEffectCall(q,op.id,claimId,0,receipt()))
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT reject_effect_audit CHECK(false) NOT VALID')
 try{await assert.rejects(tx(async q=>{const result=await applyTenantEffectSeed(q,proof(),snapshot,'menu',[{name:'Rollback',products:[{name:'Rollback item',price:1}]}]);await finishTenantOperation(q,proof(),op.id,claimId,result)}),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT reject_effect_audit')}
 assert.equal((await rows('categories')).length,1);assert.equal((await rows('products')).length,1);assert.equal((await rows('ai_usage_events')).length,1)
 assert.equal((await admin.query('SELECT status FROM app_tenant_operations WHERE id=$1',[op.id])).rows[0].status,'running')
})
test('cross-tenant menu/category and changed catalog snapshots cannot consume generated content',async()=>{
 await assert.rejects(read(q=>readTenantEffectCatalog(q,proof(),foreign,menu)),{status:404})
 const snapshot=await read(q=>readTenantEffectCatalog(q,proof(),tenant,menu))
 await admin.query("UPDATE products SET name='Changed by editor' WHERE id=$1",[product])
 await assert.rejects(tx(q=>applyTenantEffectSeed(q,proof(),snapshot,'menu',[{name:'Do not insert',products:[]}])),{status:409})
 assert.equal((await rows('categories')).length,1)
})
test('OCR tickets bind exact actor/session/tenant/nonce, expiry, byte count and digest and consume only once',async()=>{
 const content=Buffer.from('synthetic-image'),ticketOp=await reserve('ocr-upload',{size:content.length,contentType:'image/png',filename:'synthetic.png',contentDigest:tenantEffectByteDigest(content)})
 const ticket=await tx(q=>prepareNativeUploadTicket(q,proof(),ticketOp)),path=String(ticket.storage_path)
 assert.ok(path.startsWith(tenant+'/ocr/'));assert.equal((await tx(q=>prepareNativeUploadTicket(q,proof(),ticketOp))).storage_path,path)
 const ocr=await reserve('ocr',{menuId:menu,storagePath:path})
 await assert.rejects(tx(q=>consumeNativeOcrTicket(q,proof(4),ocr,path)),{status:404})
 await assert.rejects(tx(q=>consumeNativeOcrTicket(q,proof(),ocr,tenant+'/ocr/'+randomUUID()+'.png')),{status:409})
 await admin.query('UPDATE app_tenant_uploads SET expires_at=clock_timestamp() WHERE storage_path=$1',[path]);await assert.rejects(tx(q=>consumeNativeOcrTicket(q,proof(),ocr,path)),{status:409})
 await admin.query("UPDATE app_tenant_uploads SET expires_at=clock_timestamp()+interval '5 minutes' WHERE storage_path=$1",[path])
 const foreignOp=await tx(q=>reserveTenantOperation(q,proof(),foreign,'ocr',randomUUID(),{menuId:otherMenu,storagePath:path}))
 await assert.rejects(tx(q=>consumeNativeOcrTicket(q,proof(),foreignOp,path)),{status:409})
 const consumed=await tx(q=>consumeNativeOcrTicket(q,proof(),ocr,path));assert.equal(consumed.content_digest,tenantEffectByteDigest(content));assert.equal(Number(consumed.byte_length),content.length)
 await assert.rejects(tx(q=>consumeNativeOcrTicket(q,proof(),ocr,path)),{status:409})
})
test('an image job yields one private worker nonce per step, records AI/storage once and advances only after actual apply',async()=>{
 const job=await reserve('image-job',{menuId:menu,engine:'google'}),step=await tx(q=>prepareNativeImageStep(q,proof(),job.id));assert.equal(step.state,'ready');assert.ok(step.state==='ready')
 assert.equal((await tx(q=>prepareNativeImageStep(q,proof(),job.id))).state,'processing')
 await assert.rejects(tx(q=>prepareTenantEffectCall(q,proof(),job.id,step.claimId,0,'seed_image',{},randomUUID())),{status:409})
 await tx(q=>prepareTenantEffectCall(q,proof(),job.id,step.claimId,0,'seed_image',{},step.workerNonce))
 await tx(q=>recordTenantEffectCall(q,job.id,step.claimId,0,receipt('seed_image')))
 await tx(q=>prepareTenantEffectCall(q,proof(),job.id,step.claimId,1,'storage',{}));await tx(q=>recordTenantEffectCall(q,job.id,step.claimId,1,receipt('storage')))
 const progress=await tx(async q=>{await applyTenantEffectImage(q,proof(),step.snapshot,product,'https://assets.synthetic.invalid/'+product+'.webp');return advanceNativeImageStep(q,proof(),job.id,step.claimId,0)})
 assert.equal(progress.state,'applied');assert.equal((await read(q=>nativeOperationStatus(q,proof(),tenant,job.id))).status,'complete')
 assert.equal((await rows('ai_usage_events')).length,1);assert.equal((await tx(q=>prepareNativeImageStep(q,proof(),job.id))).state,'applied')
})
test('CRM claims serialize tenant intentions and preserve no-note manual/OAuth semantics, then persist only real IDs with mandatory audit',async()=>{
 const effect=await tx(q=>enqueueNativeTenantEffect(q,{tenantId:tenant,reason:'manual',eventId:'manual:'+randomUUID()}))
 const facts=await read(q=>readNativeCrmFacts(q,effect));assert.ok(facts)
 const claim=await tx(q=>claimNativeCrmEffect(q,effect,facts,'+12025550123',Date.now()));assert.ok(!('skipped'in claim))
 assert.equal(claim.payload.note,undefined);assert.equal(claim.payload.company.phone,'+12025550123')
 const duplicate=await tx(q=>claimNativeCrmEffect(q,effect,facts,null,Date.now()));assert.ok('skipped'in duplicate);assert.equal(duplicate.skipped,'processing')
 const response={ok:true,account_id:randomUUID(),contact_id:null,opportunity_id:randomUUID()}
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT reject_crm_audit CHECK(false) NOT VALID')
 try{await assert.rejects(tx(q=>completeNativeCrmEffect(q,effect,claim.claimId,claim.requestDigest,response)),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT reject_crm_audit')}
 assert.equal((await admin.query('SELECT xphere_account_id FROM tenants WHERE id=$1',[tenant])).rows[0].xphere_account_id,null)
 await tx(q=>completeNativeCrmEffect(q,effect,claim.claimId,claim.requestDigest,response))
 assert.equal((await admin.query('SELECT status FROM app_tenant_effects WHERE id=$1',[effect])).rows[0].status,'delivered')
 assert.equal((await admin.query('SELECT xphere_account_id FROM tenants WHERE id=$1',[tenant])).rows[0].xphere_account_id,response.account_id)
})
test('CRM transport ambiguity stays reconcile and a later job cannot pass that unresolved intention',async()=>{
 const first=await tx(q=>enqueueNativeTenantEffect(q,{tenantId:tenant,reason:'onboarded'})),facts=await read(q=>readNativeCrmFacts(q,first));assert.ok(facts)
 const claim=await tx(q=>claimNativeCrmEffect(q,first,facts,null,Date.now()));assert.ok(!('skipped'in claim))
 await tx(q=>reconcileNativeCrmEffect(q,first,claim.claimId));const later=await tx(q=>enqueueNativeTenantEffect(q,{tenantId:tenant,reason:'plan_changed',eventId:'operation:'+randomUUID()}))
 const laterFacts=await read(q=>readNativeCrmFacts(q,later));assert.ok(laterFacts)
 await assert.rejects(tx(q=>claimNativeCrmEffect(q,later,laterFacts,null,Date.now())),{status:503})
 const duplicate=await tx(q=>claimNativeCrmEffect(q,first,facts,null,Date.now()));assert.ok('skipped'in duplicate);assert.equal(duplicate.skipped,'reconcile')
})
test('SaaS event state, exact real event ID, processed marker and CRM intention commit atomically and replay once',async()=>{
 await admin.query("UPDATE tenant_subscriptions SET status='past_due' WHERE tenant_id=$1",[tenant])
 const event={id:'evt_'+randomUUID().replaceAll('-',''),type:'checkout.session.completed',data:{object:{metadata:{tenant_id:tenant,kind:'plan',plan_id:plan},subscription:'sub_synthetic',customer:'cus_synthetic'}}}
 await admin.query('ALTER TABLE app_tenant_effects ADD CONSTRAINT reject_financial_effect CHECK(false) NOT VALID')
 try{await assert.rejects(tx(q=>applySaasWebhook(q,event)),{status:503})}finally{await admin.query('ALTER TABLE app_tenant_effects DROP CONSTRAINT reject_financial_effect')}
 assert.equal((await rows('processed_stripe_events')).length,0);assert.equal((await admin.query('SELECT status FROM tenant_subscriptions WHERE tenant_id=$1',[tenant])).rows[0].status,'past_due')
 const results=await Promise.all([tx(q=>applySaasWebhook(q,event)),tx(q=>applySaasWebhook(q,event))]);assert.equal(results.filter(row=>row.skipped).length,1)
 assert.equal((await rows('app_tenant_effects')).length,1);assert.equal((await admin.query('SELECT event_id FROM app_tenant_effects')).rows[0].event_id,event.id)
 assert.equal((await rows('processed_stripe_events')).length,1)
})
test('OAuth completion and local disconnect cannot commit without their exact durable CRM intention; no code/secret is stored in it',async()=>{
 const context={actorId:ids[1],tenantId:tenant,role:'store-admin' as const,sessionHash:hashes[1]},attempt={nonceHash:'d'.repeat(64),codeHash:'e'.repeat(64),expiresAt:Date.now()+60000}
 assert.equal(await tx(q=>claimNativeStripeOAuth(q,context,attempt)),'claimed')
 await admin.query('ALTER TABLE app_tenant_effects ADD CONSTRAINT reject_connect_effect CHECK(false) NOT VALID')
 try{await assert.rejects(tx(q=>completeNativeStripeOAuth(q,context,attempt,'acct_synthetic')),{status:503})}finally{await admin.query('ALTER TABLE app_tenant_effects DROP CONSTRAINT reject_connect_effect')}
 assert.equal((await rows('stripe_connections')).length,0);assert.equal((await admin.query('SELECT state FROM app_stripe_oauth_attempts')).rows[0].state,'claimed')
 await tx(q=>completeNativeStripeOAuth(q,context,attempt,'acct_synthetic'))
 assert.equal((await admin.query('SELECT event_id FROM app_tenant_effects')).rows[0].event_id,'oauth:'+attempt.nonceHash)
 assert.ok(!JSON.stringify(await rows('app_tenant_effects')).includes(attempt.codeHash))
 await tx(q=>disconnectNativeStripe(q,context));assert.equal((await admin.query('SELECT is_active FROM stripe_connections')).rows[0].is_active,false)
 assert.equal((await rows('app_tenant_effects')).length,2)
})

test('backfill keeps all 100-row boundary ties, microseconds and null timestamps, deduplicates exact page replay and emits no note',async()=>{
 await admin.query("UPDATE tenants SET created_at='2026-01-01T00:00:00.123456Z'")
 for(let index=0;index<101;index++)await admin.query("INSERT INTO tenants(name,slug,created_at) VALUES('Synthetic',$1,$2)",['batch-'+index,index===0?null:'2026-01-01T00:00:00.123456Z'])
 const key=randomUUID(),first=await tx(q=>enqueueNativeTenantEffectBatch(q,proof(),{requestKey:key}))
 assert.equal(first.intentions.length,100);assert.equal(first.done,false)
 const replay=await tx(q=>enqueueNativeTenantEffectBatch(q,proof(),{requestKey:key}));assert.deepEqual(replay,first)
 assert.equal((await rows('app_tenant_effects')).length,100)
 const second=await tx(q=>enqueueNativeTenantEffectBatch(q,proof(),{requestKey:randomUUID(),cursor:first.nextCursor}))
 assert.equal(second.intentions.length,3);assert.equal(second.done,true)
 assert.equal(new Set([...first.intentions,...second.intentions].map(row=>row.tenantId)).size,103)
 const effect=first.intentions.find(row=>row.tenantId===tenant)??second.intentions.find(row=>row.tenantId===tenant);assert.ok(effect)
 const facts=await read(q=>readNativeCrmFacts(q,effect.effectId));assert.ok(facts)
 const claim=await tx(q=>claimNativeCrmEffect(q,effect.effectId,facts,null,Date.now()));assert.ok(!('skipped'in claim))
 assert.equal(claim.payload.note,undefined)
 await assert.rejects(tx(q=>enqueueNativeTenantEffectBatch(q,proof(),{requestKey:randomUUID(),limit:101})),{status:400})
 await assert.rejects(tx(q=>enqueueNativeTenantEffectBatch(q,proof(),{requestKey:randomUUID(),cursor:'2026-01-01'})),{status:400})
})

test('backfill current session and audit refusal roll back every intention without modifying existing IDs',async()=>{
 const before=await rows('profiles')
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT reject_batch_audit CHECK(false) NOT VALID')
 try{await assert.rejects(tx(q=>enqueueNativeTenantEffectBatch(q,proof(),{requestKey:randomUUID()})),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT reject_batch_audit')}
 assert.equal((await rows('app_tenant_effects')).length,0)
 await admin.query('UPDATE app_sessions SET expires_at=clock_timestamp() WHERE user_id=$1',[ids[0]])
 await assert.rejects(tx(q=>enqueueNativeTenantEffectBatch(q,proof(),{requestKey:randomUUID()})),{status:403})
 assert.deepEqual(await rows('profiles'),before)
})

test('onboarding and its CRM intention/audit roll back together; current revoked session cannot onboard',async()=>{
 await admin.query("INSERT INTO plans(slug,is_active) VALUES('menu',true)")
 const input={company_name:'New synthetic',tenant_slug:'new-synthetic',menu_name:'Menu',menu_slug:'menu',menu_purpose:'restaurant',category_name:'Food',product_name:'Soup',product_price:12}
 const before=await rows('profiles')
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT reject_onboard_audit CHECK(false) NOT VALID')
 try{await assert.rejects(tx(q=>nativeOnboarding(q,ids[2],hashes[2],input)),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT reject_onboard_audit')}
 assert.deepEqual(await rows('profiles'),before);assert.equal((await rows('tenants')).length,2);assert.equal((await rows('app_tenant_effects')).length,0)
 await admin.query('UPDATE app_accounts SET session_version=1 WHERE id=$1',[ids[2]])
 await assert.rejects(tx(q=>nativeOnboarding(q,ids[2],hashes[2],input)))
 await admin.query('UPDATE app_accounts SET session_version=0 WHERE id=$1',[ids[2]])
 const done=await tx(q=>nativeOnboarding(q,ids[2],hashes[2],input));assert.ok('tenant_id'in done)
 const effect=(await admin.query('SELECT tenant_id,kind,event_id FROM app_tenant_effects')).rows[0]
 assert.equal(effect.tenant_id,done.tenant_id);assert.equal(effect.kind,'onboarded');assert.equal(effect.event_id,'onboarding:'+done.tenant_id)
 assert.equal((await rows('profiles')).length,7);assert.equal((await rows('app_identity_bindings')).length,7)
 assert.equal((await admin.query('SELECT role FROM profiles WHERE id=$1',[ids[2]])).rows[0].role,'store-admin')
})
