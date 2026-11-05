// Disposable CI only. No dotenv, actual provider, Source access or live DDL.
import {before,after,beforeEach,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {adminMenuTransaction} from '../../src/lib/data/admin-menus-runtime'
import {readNativePublishedPosts,readNativePublishedPost,readNativeBlogTenant} from '../../src/lib/blog/native/public-data'
import {saveNativeBlogSettings,decideNativeBlogPost,readNativeBlogState,changeNativeRssSource} from '../../src/lib/blog/native/admin-data'
import {reserveNativeBlogOperation,claimNativeBlogOperation,prepareNativeBlogCall,recordNativeBlogCall,finishNativeBlogOperation,reconcileNativeBlogOperation} from '../../src/lib/blog/native/operations'
import type {NativeBlogActor} from '../../src/lib/blog/native/authority'
import {applyNativeTelegramDecision} from '../../src/lib/blog/native/telegram-data'
const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable blog target required')
const selected=new URL(raw)
if(!['localhost','127.0.0.1'].includes(selected.hostname)||selected.pathname!=='/xmartmenu_identity_test'||selected.search||selected.hash)throw Error('Disposable blog target required')
const target=new URL(selected);target.pathname='/xmartmenu'
const control=new pg.Pool({connectionString:raw,max:1}),admin=new pg.Pool({connectionString:target.href,max:2,options:'-c role=xmartmenu_owner'}),backend=new pg.Pool({connectionString:target.href,max:2,options:'-c role=xmartmenu_blog_fixture -c default_transaction_read_only=on'})
const ids=Array.from({length:7},()=>randomUUID()),tenant=randomUUID(),foreign=randomUUID(),plan=randomUUID(),hashes=ids.map(id=>createHash('sha256').update('synthetic-blog-'+id).digest('hex'))
let created=false,ownerCreated=false,backendCreated=false,authenticatedAt=0
const actor=(index=0):NativeBlogActor=>({actorId:ids[index],sessionHash:hashes[index],scope:index===0?null:tenant,projectId:'skaleclub',subject:'subject-'+index,authenticatedAt,checkedAt:Date.now()})
const context=(index=0)=>({kind:'browser' as const,actor:actor(index)})
const tx=<T>(operation:Parameters<typeof adminMenuTransaction<T>>[2])=>adminMenuTransaction(backend,true,operation)
const read=<T>(operation:Parameters<typeof adminMenuTransaction<T>>[2])=>adminMenuTransaction(backend,false,operation)
const rows=async(table:string)=>(await admin.query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`)).rows
before(async()=>{
 assert.equal((await control.query("SELECT count(*)::int AS n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0)
 await control.query('CREATE ROLE xmartmenu_owner NOLOGIN');ownerCreated=true
 await control.query('CREATE ROLE xmartmenu_blog_fixture NOLOGIN BYPASSRLS');backendCreated=true
 await control.query('CREATE DATABASE xmartmenu OWNER xmartmenu_owner');created=true
 await admin.query(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE tenants(id uuid PRIMARY KEY,name text,slug text UNIQUE,is_active boolean DEFAULT true);
 CREATE TABLE profiles(id uuid PRIMARY KEY,role text,tenant_id uuid REFERENCES tenants(id),must_change_password boolean DEFAULT false);
 CREATE TABLE app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz,session_version int DEFAULT 0);
 CREATE TABLE app_identity_bindings(project_id text,subject text,user_id uuid REFERENCES app_accounts(id),disabled_at timestamptz,PRIMARY KEY(project_id,subject));
 CREATE TABLE app_sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES app_accounts(id),session_version int,authenticated_at timestamptz,expires_at timestamptz,project_id text,subject text);
 CREATE TABLE plans(id uuid PRIMARY KEY,name text,slug text,description text,monthly_price numeric,annual_price numeric,transaction_fee_pct numeric,features jsonb);
 CREATE TABLE tenant_subscriptions(tenant_id uuid UNIQUE REFERENCES tenants(id),plan_id uuid REFERENCES plans(id),billing_cycle text,status text,override_monthly_price numeric,override_annual_price numeric,override_transaction_fee_pct numeric,override_notes text);
 CREATE TABLE audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid,actor_id uuid,via text,table_name text,record_id text,action text,changes jsonb);
 CREATE TABLE ai_usage_events(id bigserial PRIMARY KEY,tenant_id uuid,feature text,model text,key_source text,billable boolean,cost_usd numeric,markup_pct numeric,charge_usd numeric,generation_id text,request_id text);`)
 await admin.query(await readFile(new URL('../../supabase/migrations/058_platform_blog.sql',import.meta.url),'utf8'))
 await admin.query(await readFile(new URL('../../docs/proposals/native-blog-operations-owned-only.sql',import.meta.url),'utf8'))
 for(const id of ids)await admin.query('INSERT INTO auth.users VALUES($1)',[id])
 await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_blog_fixture;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_blog_fixture;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO xmartmenu_blog_fixture')
})
beforeEach(async()=>{
 await admin.query('TRUNCATE app_blog_calls,app_blog_operations,blog_generation_jobs,blog_post_feedback,blog_rss_items,blog_rss_sources,blog_posts,blog_settings,telegram_settings,ai_generation_logs,ai_usage_events,audit_events,app_sessions,app_identity_bindings,profiles,app_accounts,tenant_subscriptions,tenants,plans CASCADE')
 await admin.query("INSERT INTO tenants VALUES($1,'Synthetic','synthetic',true),($2,'Foreign','foreign',true)",[tenant,foreign])
 await admin.query("INSERT INTO plans VALUES($1,'Blog','blog',NULL,10,100,0.015,'[\"blog\"]')",[plan])
 await admin.query("INSERT INTO tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$3,'monthly','active'),($2,$3,'monthly','active')",[tenant,foreign,plan])
 authenticatedAt=Math.floor(Date.now()/1000)
 for(const [index,id] of ids.entries()){
  await admin.query('INSERT INTO app_accounts(id,disabled_at) VALUES($1,$2)',[id,index===5?new Date('2026-01-01'):null])
  await admin.query('INSERT INTO profiles VALUES($1,$2,$3,$4)',[id,index===0?'superadmin':index===1||index===5?'store-admin':index===2?'store-staff':'customer',index===0?null:tenant,index===6])
  await admin.query("INSERT INTO app_identity_bindings VALUES('skaleclub',$1,$2,NULL)",['subject-'+index,id])
  await admin.query("INSERT INTO app_sessions VALUES($1,$2,0,$3,clock_timestamp()+interval '1 day','skaleclub',$4)",[hashes[index],id,new Date(authenticatedAt*1000),'subject-'+index])
 }
})
after(async()=>{await backend.end();await admin.end();if(created)await control.query('DROP DATABASE xmartmenu');if(backendCreated)await control.query('DROP ROLE xmartmenu_blog_fixture');if(ownerCreated)await control.query('DROP ROLE xmartmenu_owner');await control.end()})
const post=async(scope:string|null,status='draft',published:Date|null=null)=>(await admin.query("INSERT INTO blog_posts(tenant_id,title,slug,content,excerpt,status,published_at,ai_generated) VALUES($1,'Synthetic article','same-slug','<p>Safe</p>','Synthetic',$2,$3,true) RETURNING id",[scope,status,published])).rows[0].id as string

test('published/future/scope and current tenant/plan gates are SQL-native; Source Auth remains inaccessible',async()=>{
 const now=new Date(Date.now()-1000)
 await post(null,'published',now);await post(tenant,'published',now);await post(foreign,'published',new Date(Date.now()+60000))
 assert.equal((await read(q=>readNativePublishedPosts(q,null))).length,1)
 assert.equal((await read(q=>readNativePublishedPosts(q,tenant))).length,1)
 assert.equal(await read(q=>readNativePublishedPost(q,foreign,'same-slug')),null)
 await admin.query('UPDATE tenants SET is_active=false WHERE id=$1',[tenant])
 assert.equal(await read(q=>readNativeBlogTenant(q,'synthetic')),null)
 assert.deepEqual(await read(q=>readNativePublishedPosts(q,tenant)),[])
 await assert.rejects(backend.query('SELECT * FROM auth.users'),{code:'42501'})
})
test('real current administrator/staff scope is preserved, while role/session/binding/disabled/reset changes deny',async()=>{
 await tx(q=>saveNativeBlogSettings(q,actor(1),{enabled:true,postsPerDay:4}))
 await tx(q=>changeNativeRssSource(q,actor(2),{action:'add',name:'Synthetic',url:'https://example.test/rss'}))
 await assert.rejects(tx(q=>saveNativeBlogSettings(q,actor(1),{postsPerDay:5})),{status:400})
 for(const index of [3,5,6])await assert.rejects(read(q=>readNativeBlogState(q,actor(index))),{status:403})
 await admin.query('UPDATE app_accounts SET session_version=1 WHERE id=$1',[ids[1]])
 await assert.rejects(tx(q=>saveNativeBlogSettings(q,actor(1),{enabled:false})),{status:403})
 assert.equal((await rows('app_accounts')).length,7)
})
test('approval/feedback/audit are atomic and concurrent approve emits one feedback; another tenant post is denied',async()=>{
 const id=await post(tenant),other=await post(foreign)
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT fail_blog_audit CHECK(false) NOT VALID')
 try{await assert.rejects(tx(q=>decideNativeBlogPost(q,actor(1),{postId:id,action:'approve'})),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT fail_blog_audit')}
 assert.equal((await rows('blog_post_feedback')).length,0)
 assert.equal((await admin.query('SELECT status FROM blog_posts WHERE id=$1',[id])).rows[0].status,'draft')
 await Promise.all([tx(q=>decideNativeBlogPost(q,actor(1),{postId:id,action:'approve'})),tx(q=>decideNativeBlogPost(q,actor(1),{postId:id,action:'approve'}))])
 assert.equal((await rows('blog_post_feedback')).length,1)
 await assert.rejects(tx(q=>decideNativeBlogPost(q,actor(1),{postId:other,action:'reject'})),{status:404})
})
test('exact request replay and concurrent claim cannot repeat a paid call; a known receipt survives revocation without apply',async()=>{
 const key=randomUUID(),op=await tx(q=>reserveNativeBlogOperation(q,context(1),'generation',key,{trigger:'manual'}))
 assert.equal((await tx(q=>reserveNativeBlogOperation(q,context(1),'generation',key,{trigger:'manual'}))).id,op.id)
 await assert.rejects(tx(q=>reserveNativeBlogOperation(q,context(1),'generation',key,{trigger:'cron'})),{status:409})
 const claims=await Promise.allSettled([tx(q=>claimNativeBlogOperation(q,context(1),op.id,'a'.repeat(64))),tx(q=>claimNativeBlogOperation(q,context(1),op.id,'a'.repeat(64)))])
 assert.equal(claims.filter(result=>result.status==='fulfilled').length,1)
 const winner=claims.find(result=>result.status==='fulfilled');assert.ok(winner&&winner.status==='fulfilled')
 const claimed=winner.value;assert.ok(claimed.claimId)
 const claimId=claimed.claimId
 await tx(q=>prepareNativeBlogCall(q,context(1),op.id,claimId,0,'ai',{prompt:'synthetic'},{apiKey:'synthetic-offline',keySource:'platform',billable:false,markupPct:0},'synthetic/model'))
 await assert.rejects(tx(q=>prepareNativeBlogCall(q,context(1),op.id,claimId,0,'ai',{})),{status:409})
 await admin.query('UPDATE app_accounts SET session_version=1 WHERE id=$1',[ids[1]])
 const fact={costUsd:0.125,generationId:'synthetic',tokens:42,inputTokens:30,outputTokens:12}
 await tx(q=>recordNativeBlogCall(q,op.id,claimId,0,{text:'synthetic'},fact))
 await tx(q=>recordNativeBlogCall(q,op.id,claimId,0,{text:'synthetic'},fact))
 assert.equal((await rows('ai_usage_events')).length,1)
 await assert.rejects(tx(q=>finishNativeBlogOperation(q,context(1),op.id,claimId,{ok:true})),{status:403})
 await tx(q=>reconcileNativeBlogOperation(q,op.id,claimId))
 assert.equal((await admin.query('SELECT status FROM app_blog_operations WHERE id=$1',[op.id])).rows[0].status,'reconcile')
})
test('Telegram callback secret/chat/scope/current capability and atomic audit prevent replay or cross-tenant approval',async()=>{
 const id=await post(tenant),other=await post(foreign),settingsId=randomUUID(),secret='synthetic-offline-secret'
 await admin.query('INSERT INTO telegram_settings(id,tenant_id,enabled,approvals_enabled,webhook_secret,approvals_chat_ids) VALUES($1,$2,true,true,$3,ARRAY[\'-100123:42\'])',[settingsId,tenant,secret])
 const proof={kind:'telegram' as const,scope:tenant,settingsId,secretHash:createHash('sha256').update(secret).digest('hex')},input={callbackQueryId:'synthetic-callback',chatId:'-100123',postId:id,action:'approve' as const}
 await assert.rejects(tx(q=>applyNativeTelegramDecision(q,{...proof,secretHash:'a'.repeat(64)},input)),{status:403})
 await assert.rejects(tx(q=>applyNativeTelegramDecision(q,proof,{...input,chatId:'-100999'})),{status:403})
 const foreignResult=await tx(q=>applyNativeTelegramDecision(q,proof,{...input,callbackQueryId:'foreign-callback',postId:other}));assert.equal(foreignResult.result?.ignored,true)
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT fail_telegram_audit CHECK(false) NOT VALID')
 try{await assert.rejects(tx(q=>applyNativeTelegramDecision(q,proof,input)),{status:503})}finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT fail_telegram_audit')}
 assert.equal((await admin.query('SELECT status FROM blog_posts WHERE id=$1',[id])).rows[0].status,'draft')
 await tx(q=>applyNativeTelegramDecision(q,proof,input));await tx(q=>applyNativeTelegramDecision(q,proof,input))
 assert.equal((await rows('blog_post_feedback')).length,1)
 await admin.query('UPDATE telegram_settings SET approvals_enabled=false WHERE id=$1',[settingsId])
 await assert.rejects(tx(q=>applyNativeTelegramDecision(q,proof,{...input,callbackQueryId:'disabled-callback'})),{status:403})
})
test('SQL role, expiry, version, live binding, provider tuple, disabled/recovery and capability changes invalidate the next phase',async()=>{
 for(const change of ["UPDATE profiles SET role='customer' WHERE id=$1",'UPDATE app_accounts SET disabled_at=clock_timestamp() WHERE id=$1','UPDATE app_accounts SET session_version=1 WHERE id=$1','UPDATE app_sessions SET expires_at=clock_timestamp() WHERE user_id=$1','UPDATE app_identity_bindings SET disabled_at=clock_timestamp() WHERE user_id=$1','UPDATE profiles SET must_change_password=true WHERE id=$1']){
  await admin.query(change,[ids[1]])
  await assert.rejects(read(q=>readNativeBlogState(q,actor(1))),{status:403})
  await admin.query("UPDATE profiles SET role='store-admin',must_change_password=false WHERE id=$1",[ids[1]])
  await admin.query('UPDATE app_accounts SET disabled_at=NULL,session_version=0 WHERE id=$1',[ids[1]])
  await admin.query("UPDATE app_sessions SET expires_at=clock_timestamp()+interval '1 day' WHERE user_id=$1",[ids[1]])
  await admin.query('UPDATE app_identity_bindings SET disabled_at=NULL WHERE user_id=$1',[ids[1]])
 }
 await admin.query("UPDATE app_identity_bindings SET subject='other-synthetic' WHERE user_id=$1",[ids[1]])
 await admin.query("UPDATE app_sessions SET subject='other-synthetic' WHERE user_id=$1",[ids[1]])
 await assert.rejects(read(q=>readNativeBlogState(q,actor(1))),{status:403})
 await admin.query("UPDATE app_identity_bindings SET subject='subject-1' WHERE user_id=$1",[ids[1]])
 await admin.query("UPDATE app_sessions SET subject='subject-1' WHERE user_id=$1",[ids[1]])
 await assert.rejects(read(q=>readNativeBlogState(q,{...actor(1),checkedAt:Date.now()-5001})),{status:403})
 await admin.query("UPDATE plans SET features='[]'")
 await assert.rejects(read(q=>readNativeBlogState(q,actor(1))),{status:403})
 assert.equal((await rows('app_identity_bindings')).length,7)
 assert.equal((await admin.query('SELECT disabled_at FROM app_accounts WHERE id=$1',[ids[5]])).rows[0].disabled_at.toISOString(),'2026-01-01T00:00:00.000Z')
})
