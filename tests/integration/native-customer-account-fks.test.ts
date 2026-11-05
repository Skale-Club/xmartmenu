// Disposable loopback only. Never loads .env or connects to any live database.
import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'

const raw=process.env.IDENTITY_TEST_DATABASE_URL
if(!raw)throw Error('Explicit disposable customer FK target required')
const source=new URL(raw)
if(!['127.0.0.1','localhost'].includes(source.hostname)||source.pathname!=='/xmartmenu_identity_test'||source.search||source.hash)throw Error('Disposable customer FK target required')
const selected=new URL(source);selected.pathname='/xmartmenu'
const control=new pg.Pool({connectionString:raw,max:1,statement_timeout:5000})
const admin=new pg.Pool({connectionString:selected.href,max:1,statement_timeout:5000,options:'-c role=xmartmenu_owner'})
const backend=new pg.Pool({connectionString:selected.href,max:1,statement_timeout:5000,options:'-c role=xmartmenu_runtime'})
const legacy=randomUUID(),native=randomUUID(),originalOrder=randomUUID()
let databaseCreated=false,ownerCreated=false,runtimeCreated=false
let proposal=''
const rows=async()=>({profiles:(await admin.query('SELECT * FROM public.customer_profiles ORDER BY id')).rows,
  orders:(await admin.query('SELECT * FROM public.orders ORDER BY id')).rows,accounts:(await admin.query('SELECT * FROM public.app_accounts ORDER BY id')).rows,
  auth:(await admin.query('SELECT * FROM auth.users ORDER BY id')).rows})
before(async()=>{
  assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0,'Never reuse an existing database')
  await control.query('CREATE ROLE xmartmenu_owner NOLOGIN');ownerCreated=true
  await control.query('CREATE ROLE xmartmenu_runtime NOLOGIN BYPASSRLS');runtimeCreated=true
  await control.query('CREATE DATABASE xmartmenu OWNER xmartmenu_owner');databaseCreated=true
  await admin.query(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
    CREATE TABLE public.customer_profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,full_name text,payload jsonb);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,total numeric,currency text,payload jsonb);
    ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public TO xmartmenu_runtime;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_runtime`)
  await admin.query('INSERT INTO auth.users VALUES($1)',[legacy])
  await admin.query('INSERT INTO public.app_accounts VALUES($1,NULL),($2,NULL)',[legacy,native])
  await admin.query("INSERT INTO public.customer_profiles VALUES($1,'Preserved fixture','{\"test\":true}')",[legacy])
  await admin.query("INSERT INTO public.orders VALUES($1,$2,12.34,'usd','{\"items\":[1,2]}')",[originalOrder,legacy])
  proposal=await readFile(new URL('../../docs/proposals/native-customer-account-fks-owned-only.sql',import.meta.url),'utf8')
})
after(async()=>{
  await backend.end();await admin.end()
  if(databaseCreated)await control.query('DROP DATABASE xmartmenu')
  if(runtimeCreated)await control.query('DROP ROLE xmartmenu_runtime')
  if(ownerCreated)await control.query('DROP ROLE xmartmenu_owner')
  await control.end()
})
test('old FKs reject a native account with no Source Auth stub',async()=>{
  await assert.rejects(backend.query('INSERT INTO public.customer_profiles(id) VALUES($1)',[native]),{code:'23503'})
  await assert.rejects(backend.query('INSERT INTO public.orders(id,customer_id) VALUES($1,$2)',[randomUUID(),native]),{code:'23503'})
})
test('wrong target/role and orphan references refuse without changing either FK or data',async()=>{
  await assert.rejects(control.query(proposal),/Exact owned candidate owner required/);await control.query('ROLLBACK')
  await assert.rejects(backend.query(proposal),/Exact owned candidate owner required/);await backend.query('ROLLBACK')
  for(const table of ['customer_profiles','orders']){
    const orphan=randomUUID(),order=randomUUID();await admin.query('INSERT INTO auth.users VALUES($1)',[orphan])
    if(table==='customer_profiles')await admin.query('INSERT INTO public.customer_profiles(id) VALUES($1)',[orphan])
    else await admin.query('INSERT INTO public.orders(id,customer_id) VALUES($1,$2)',[order,orphan])
    const before=await rows();await assert.rejects(admin.query(proposal),/Unreconciled customer account UUIDs/);await admin.query('ROLLBACK')
    assert.deepEqual(await rows(),before)
    if(table==='customer_profiles')await admin.query('DELETE FROM public.customer_profiles WHERE id=$1',[orphan])
    else await admin.query('DELETE FROM public.orders WHERE id=$1',[order])
    await admin.query('DELETE FROM auth.users WHERE id=$1',[orphan])
  }
})
test('the exact owned proposal preserves every row, RLS and validated FK actions',async()=>{
  const before=await rows();await admin.query(proposal);assert.deepEqual(await rows(),before)
  const constraints=(await admin.query(`SELECT c.conname,c.convalidated,c.confdeltype,t.relrowsecurity FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid WHERE c.conname IN('customer_profiles_id_fkey','orders_customer_id_fkey')
    AND c.confrelid='public.app_accounts'::regclass ORDER BY c.conname`)).rows
  assert.deepEqual(constraints,[{conname:'customer_profiles_id_fkey',convalidated:true,confdeltype:'c',relrowsecurity:true},
    {conname:'orders_customer_id_fkey',convalidated:true,confdeltype:'n',relrowsecurity:true}])
  await assert.rejects(admin.query(proposal),/Exact legacy customer FKs required/);await admin.query('ROLLBACK')
})
test('native customers can create profiles/orders; unknown IDs remain blocked and Auth is untouched/inaccessible',async()=>{
  await backend.query("INSERT INTO public.customer_profiles(id,full_name) VALUES($1,'Native fixture')",[native])
  await backend.query('INSERT INTO public.orders(id,customer_id) VALUES($1,$2)',[randomUUID(),native])
  await assert.rejects(backend.query('INSERT INTO public.customer_profiles(id) VALUES($1)',[randomUUID()]),{code:'23503'})
  await assert.rejects(backend.query('SELECT * FROM auth.users'),{code:'42501'})
  assert.deepEqual((await admin.query('SELECT id FROM auth.users')).rows,[{id:legacy}])
})
test('account deletion preserves the old cascade/set-null behavior and existing unrelated history',async()=>{
  await backend.query('DELETE FROM public.app_accounts WHERE id=$1',[native])
  assert.equal((await backend.query('SELECT * FROM public.customer_profiles WHERE id=$1',[native])).rowCount,0)
  assert.equal((await backend.query('SELECT * FROM public.orders WHERE customer_id IS NULL')).rowCount,1)
  assert.equal((await backend.query('SELECT customer_id FROM public.orders WHERE id=$1',[originalOrder])).rows[0].customer_id,legacy)
  assert.deepEqual((await admin.query('SELECT id FROM auth.users')).rows,[{id:legacy}])
})
