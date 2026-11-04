// Disposable CI only. No dotenv, live Source, provider requests or production DDL.
import {before,after,beforeEach,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {adminMenuTransaction} from '../../src/lib/data/admin-menus-runtime'
import {listAdminAccounts,listStaffAccounts,changeAccountAccess,disableAccount,removeStaffAccount,issueStaffAccess,completeStaffAccess,accessCodeHash,type AccountAdminContext,type StaffProof} from '../../src/lib/data/account-administration'
const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable account administration target required')
const selected=new URL(raw)
if(!['127.0.0.1','localhost'].includes(selected.hostname)||selected.pathname!=='/xmartmenu_identity_test'||selected.search||selected.hash)throw Error('Disposable account target required')
const target=new URL(selected);target.pathname='/xmartmenu'
const control=new pg.Pool({connectionString:raw,max:1}),admin=new pg.Pool({connectionString:target.href,max:2}),backend=new pg.Pool({connectionString:target.href,max:2,options:'-c role=xmartmenu_accounts_fixture -c default_transaction_read_only=on'})
const ids=Array.from({length:7},()=>randomUUID()),tenant=randomUUID(),foreign=randomUUID(),tokens=ids.map(()=>randomBytes(32).toString('base64url'))
const context=(index=1,tenantId?:string):AccountAdminContext=>({actorId:ids[index],sessionHash:accessCodeHash(tokens[index]),
 ...(index===0||index===4 ? tenantId?{tenantId}:{} : {tenantId:tenantId??tenant})})
const proof=(index=3):StaffProof=>({userId:ids[index],projectId:'skaleclub',subject:`subject-${index}`,authenticatedAt:Math.floor(Date.now()/1000),checkedAt:Date.now()})
const issue=(index=3,kind:'invite'|'recovery'='invite',ctx=context())=>adminMenuTransaction(backend,true,query=>issueStaffAccess(query,ctx,ids[index],kind))
const complete=(code:string,kind:'invite'|'recovery'='invite',identity=proof())=>adminMenuTransaction(backend,true,query=>completeStaffAccess(query,identity,kind,code))
const rows=async(table:string)=> (await admin.query(`SELECT to_jsonb(r) row FROM public.${table} r ORDER BY to_jsonb(r)::text`)).rows
let created=false,roleCreated=false
before(async()=>{
 assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0)
 await control.query('CREATE DATABASE xmartmenu');created=true
 await control.query('CREATE ROLE xmartmenu_accounts_fixture NOLOGIN BYPASSRLS');roleCreated=true
 await admin.query(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE tenants(id uuid PRIMARY KEY,name text,slug text);
 CREATE TABLE profiles(id uuid PRIMARY KEY,role text,tenant_id uuid REFERENCES tenants(id),full_name text,phone text,
  must_change_password boolean DEFAULT false,password_changed_at timestamptz,created_at timestamptz DEFAULT now());
 CREATE TABLE app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz,session_version int NOT NULL DEFAULT 0,created_at timestamptz DEFAULT now());
 CREATE TABLE app_identity_bindings(project_id text,subject text,user_id uuid REFERENCES app_accounts(id),provider text,disabled_at timestamptz,PRIMARY KEY(project_id,subject));
 CREATE TABLE app_sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES app_accounts(id),session_version int,authenticated_at timestamptz,expires_at timestamptz,created_at timestamptz DEFAULT now(),project_id text,subject text);
 CREATE TABLE audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid,actor_id uuid,via text,table_name text,record_id text,action text,changes jsonb,occurred_at timestamptz DEFAULT now());`)
 await admin.query(await readFile(new URL('../../docs/proposals/native-account-administration-owned-only.sql',import.meta.url),'utf8'))
 await admin.query('INSERT INTO tenants VALUES($1,\'One\',\'one\'),($2,\'Two\',\'two\')',[tenant,foreign])
 for(const id of ids)await admin.query('INSERT INTO auth.users VALUES($1)',[id])
 await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_accounts_fixture;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_accounts_fixture;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO xmartmenu_accounts_fixture')
})
beforeEach(async()=>{
 await admin.query('TRUNCATE public.profiles,public.app_accounts CASCADE;TRUNCATE public.audit_events')
 for(const [index,id] of ids.entries()){
  await admin.query('INSERT INTO app_accounts(id,disabled_at) VALUES($1,$2)',[id,index===5?new Date('2026-01-01'):null])
  await admin.query('INSERT INTO profiles(id,role,tenant_id,full_name,must_change_password) VALUES($1,$2,$3,$4,$5)',[id,index===0||index===4?'superadmin':index===1||index===5?'store-admin':index===3?'customer':'store-staff',index===0||index===3||index===4?null:tenant,`Synthetic ${index}`,index===6])
  await admin.query("INSERT INTO app_identity_bindings VALUES('skaleclub',$1,$2,'google.com',NULL)",[`subject-${index}`,id])
  await admin.query("INSERT INTO app_sessions(token_hash,user_id,session_version,authenticated_at,expires_at,project_id,subject) VALUES($1,$2,0,now(),now()+interval '1 hour','skaleclub',$3)",[accessCodeHash(tokens[index]),id,`subject-${index}`])
 }
})
after(async()=>{await backend.end();await admin.end();if(created)await control.query('DROP DATABASE xmartmenu');if(roleCreated)await control.query('DROP ROLE xmartmenu_accounts_fixture');await control.end()})

test('listing is SQL scoped, bounded and carries no Source email/provider invention; runtime role cannot read Source Auth',async()=>{
 const staff=await adminMenuTransaction(backend,false,query=>listStaffAccounts(query,context()));assert.equal(staff.length,2);assert.ok(staff.every(row=>row.email===null))
 const users=await adminMenuTransaction(backend,false,query=>listAdminAccounts(query,context(0,undefined)));assert.equal(users.length,6);assert.ok(users.every(row=>row.email===null&&row.provider==='google.com'))
 await assert.rejects(backend.query('SELECT * FROM auth.users'),{code:'42501'})
 await assert.rejects(adminMenuTransaction(backend,false,query=>listAdminAccounts(query,context())),{status:403})
 await assert.rejects(adminMenuTransaction(backend,false,query=>listStaffAccounts(query,context(1,foreign))),{status:403})
 await assert.rejects(adminMenuTransaction(backend,false,query=>listStaffAccounts(query,{...context(),platformOnly:true})),{status:403})
})
test('explicit verified UID invite grants only staff on exact tenant after one use; wrong UID/project/expiry cannot burn it',async()=>{
 const source=await rows('app_identity_bindings'),before=(await admin.query('SELECT * FROM auth.users ORDER BY id')).rows
 const invitation=await issue()
 await assert.rejects(complete(invitation.code,'invite',proof(2)),{status:409})
 await assert.rejects(complete(invitation.code,'invite',{...proof(),projectId:'wrong-project'}),{status:403})
 const outcomes=await Promise.allSettled([complete(invitation.code),complete(invitation.code)])
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1)
 const profile=(await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[ids[3]])).rows[0];assert.deepEqual(profile,{role:'store-staff',tenant_id:tenant})
 assert.equal((await admin.query('SELECT session_version FROM app_accounts WHERE id=$1',[ids[3]])).rows[0].session_version,1)
 assert.equal((await admin.query('SELECT * FROM app_sessions WHERE user_id=$1',[ids[3]])).rows.length,0)
 assert.deepEqual(await rows('app_identity_bindings'),source);assert.deepEqual((await admin.query('SELECT * FROM auth.users ORDER BY id')).rows,before)
 assert.equal((await admin.query('SELECT count(*)::int n FROM profiles')).rows[0].n,7)
 assert.ok(!JSON.stringify(await rows('app_staff_access_codes')).includes(invitation.code))
})
test('historical disabled account and historical recovery flag cannot be reset, reenabled or cleared by this workflow',async()=>{
 const historicalDisabled=(await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM profiles p JOIN app_accounts a USING(id) WHERE id=$1',[ids[5]])).rows
 const historicalRecovery=(await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM profiles p JOIN app_accounts a USING(id) WHERE id=$1',[ids[6]])).rows
 await assert.rejects(issue(5,'recovery'),{status:404});await assert.rejects(issue(6,'recovery'),{status:409})
 await assert.rejects(complete(randomBytes(32).toString('base64url'),'recovery',proof(6)),{status:409})
 assert.deepEqual((await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM profiles p JOIN app_accounts a USING(id) WHERE id=$1',[ids[5]])).rows,historicalDisabled)
 assert.deepEqual((await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM profiles p JOIN app_accounts a USING(id) WHERE id=$1',[ids[6]])).rows,historicalRecovery)
 assert.equal((await rows('audit_events')).length,0)
})
test('reset concretely revokes local sessions; exact generation and fresh existing factor clear only its own flag',async()=>{
 const reset=await issue(2,'recovery'),oldVersion=(await admin.query('SELECT session_version FROM app_accounts WHERE id=$1',[ids[2]])).rows[0].session_version
 assert.equal(oldVersion,1);assert.equal((await admin.query('SELECT * FROM app_sessions WHERE user_id=$1',[ids[2]])).rows.length,0)
 assert.equal((await admin.query('SELECT must_change_password FROM profiles WHERE id=$1',[ids[2]])).rows[0].must_change_password,true)
 await assert.rejects(complete(reset.code,'recovery',{...proof(2),authenticatedAt:Math.floor(Date.now()/1000)-301}),{status:401})
 const newer=await issue(2,'recovery');await assert.rejects(complete(reset.code,'recovery',proof(2)),{status:409})
 await complete(newer.code,'recovery',proof(2));assert.equal((await admin.query('SELECT must_change_password FROM profiles WHERE id=$1',[ids[2]])).rows[0].must_change_password,false)
 assert.equal((await admin.query('SELECT must_change_password FROM profiles WHERE id=$1',[ids[6]])).rows[0].must_change_password,true)
 assert.equal((await admin.query('SELECT disabled_at FROM app_accounts WHERE id=$1',[ids[5]])).rows[0].disabled_at.toISOString(),'2026-01-01T00:00:00.000Z')
})
test('changed account version/target tenant/issuer role and disabled bindings reject an unconsumed case',async()=>{
 const invitation=await issue();await admin.query("UPDATE profiles SET role='customer',tenant_id=NULL WHERE id=$1",[ids[1]])
 await assert.rejects(complete(invitation.code),{status:403})
 await admin.query("UPDATE profiles SET role='store-admin',tenant_id=$2 WHERE id=$1",[ids[1],tenant]);await admin.query('UPDATE app_accounts SET session_version=session_version+1 WHERE id=$1',[ids[3]])
 await assert.rejects(complete(invitation.code),{status:409})
 const replacement=await issue();await admin.query('UPDATE app_identity_bindings SET disabled_at=now() WHERE user_id=$1',[ids[3]])
 await assert.rejects(complete(replacement.code),{status:403})
 assert.equal((await admin.query('SELECT used_at FROM app_staff_access_codes WHERE id=$1',[replacement.id])).rows[0].used_at,null)
})
test('staff removal and global disable preserve every UUID/provider record and immediately invalidate sessions',async()=>{
 const providers=await rows('app_identity_bindings')
 await adminMenuTransaction(backend,true,query=>removeStaffAccount(query,context(),ids[2]))
 assert.deepEqual((await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[ids[2]])).rows[0],{role:'customer',tenant_id:null})
 await adminMenuTransaction(backend,true,query=>disableAccount(query,context(0,undefined),ids[3]))
 assert.equal((await admin.query('SELECT count(*)::int n FROM profiles')).rows[0].n,7);assert.equal((await admin.query('SELECT count(*)::int n FROM app_accounts')).rows[0].n,7)
 assert.deepEqual(await rows('app_identity_bindings'),providers)
 assert.equal((await admin.query('SELECT * FROM app_sessions WHERE user_id=$1 OR user_id=$2',[ids[2],ids[3]])).rows.length,0)
})
test('opposing super-admin edits serialize and recheck caller role/session so at least one authorized operator remains',async()=>{
 await assert.rejects(adminMenuTransaction(backend,true,query=>changeAccountAccess(query,context(0),ids[0].toUpperCase(),{role:'customer',tenant_id:null})),{status:400})
 await assert.rejects(adminMenuTransaction(backend,true,query=>disableAccount(query,context(0),ids[0].toUpperCase())),{status:400})
 const results=await Promise.allSettled([
  adminMenuTransaction(backend,true,query=>changeAccountAccess(query,context(0,undefined),ids[4],{role:'customer',tenant_id:null})),
  adminMenuTransaction(backend,true,query=>changeAccountAccess(query,context(4,undefined),ids[0],{role:'customer',tenant_id:null})),
 ])
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
 assert.equal((await admin.query("SELECT count(*)::int n FROM profiles p JOIN app_accounts a USING(id) WHERE role='superadmin' AND a.disabled_at IS NULL")).rows[0].n,1)
})
test('mandatory audit failure rolls back grant, recovery reset, disable and consume together',async()=>{
 const invitation=await issue(),snapshot=await rows('profiles'),accounts=await rows('app_accounts'),sessions=await rows('app_sessions')
 await admin.query('ALTER TABLE audit_events ADD CONSTRAINT reject_audit CHECK(false) NOT VALID')
 try{
  await assert.rejects(complete(invitation.code),{status:503})
  await assert.rejects(issue(2,'recovery'),{status:503})
  await assert.rejects(adminMenuTransaction(backend,true,query=>disableAccount(query,context(0,undefined),ids[3])),{status:503})
 }finally{await admin.query('ALTER TABLE audit_events DROP CONSTRAINT reject_audit')}
 assert.deepEqual(await rows('profiles'),snapshot);assert.deepEqual(await rows('app_accounts'),accounts);assert.deepEqual(await rows('app_sessions'),sessions)
 assert.equal((await admin.query('SELECT used_at FROM app_staff_access_codes WHERE id=$1',[invitation.id])).rows[0].used_at,null)
})
test('the real 1000-staff ceiling stays readable and rejects grant overflow under the same authority lock',async()=>{
 // Native projected profiles (the separate reviewed49 Auth FK removal) need no
 // Source Auth stubs. These synthetic extra UUIDs never enter auth.users.
 await admin.query('INSERT INTO app_accounts(id) SELECT gen_random_uuid() FROM generate_series(1,998)')
 await admin.query("INSERT INTO profiles(id,role,tenant_id,full_name) SELECT a.id,'store-staff',$1,'Synthetic capacity account' FROM app_accounts a WHERE NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=a.id)",[tenant])
 const invitation=await issue()
 await assert.rejects(complete(invitation.code),{status:409})
 await assert.rejects(adminMenuTransaction(backend,true,query=>changeAccountAccess(query,context(0),ids[3],{role:'store-staff',tenant_id:tenant})),{status:409})
 assert.equal((await adminMenuTransaction(backend,false,query=>listStaffAccounts(query,context()))).length,1000)
 await adminMenuTransaction(backend,true,query=>removeStaffAccount(query,context(),ids[2]));const second=await issue(2)
 const competing=await Promise.allSettled([complete(invitation.code),complete(second.code,'invite',proof(2))])
 assert.equal(competing.filter(result=>result.status==='fulfilled').length,1)
 assert.equal((await adminMenuTransaction(backend,false,query=>listStaffAccounts(query,context()))).length,1000)
 assert.equal((await admin.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,7)
})
