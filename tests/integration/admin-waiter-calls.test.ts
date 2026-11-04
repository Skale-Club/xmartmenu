// Explicit disposable loopback CI only. Never reads .env, Source or live SQL.
import { before,after,test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { adminMenuTransaction } from '../../src/lib/data/admin-menus-runtime'
import { readAdminWaiterCalls,updateAdminWaiterCall,type AdminWaiterContext } from '../../src/lib/data/admin-waiter-calls'
import { CALL_STALE_MS } from '../../src/lib/waiter-calls'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable waiter service target required')
const selected = new URL(raw)
if (!['127.0.0.1','localhost'].includes(selected.hostname) || selected.pathname !== '/xmartmenu_identity_test' || selected.search || selected.hash) throw Error('Disposable waiter service target required')
const target = new URL(selected); target.pathname = '/xmartmenu'
const control = new pg.Pool({ connectionString: raw,max: 1,statement_timeout: 5000 })
const admin = new pg.Pool({ connectionString: target.href,max: 2,statement_timeout: 5000 })
const backend = new pg.Pool({ connectionString: target.href,max: 2,statement_timeout: 5000,options: '-c role=xmartmenu_waiter_fixture -c default_transaction_read_only=on' })
const tenant = randomUUID(), foreign = randomUUID(), table = randomUUID(), plan = randomUUID(), call = randomUUID(), foreignCall = randomUUID(), native = randomUUID()
const ids = Array.from({ length: 7 },() => randomUUID()), now = new Date()
const staff: AdminWaiterContext = { tenantId: tenant,actorId: ids[2],role: 'store-staff' }
const nativeStaff: AdminWaiterContext = { ...staff,actorId: native }
const foreignStaff: AdminWaiterContext = { tenantId: foreign,actorId: ids[3],role: 'store-staff' }
const read = (context = staff) => adminMenuTransaction(backend,false,query => readAdminWaiterCalls(query,context,now))
const update = (status: unknown,context = nativeStaff,date = now,id = call) => adminMenuTransaction(backend,true,query => updateAdminWaiterCall(query,context,id,status,date))
const stored = async () => (await admin.query('SELECT * FROM public.waiter_calls WHERE id=$1',[call])).rows[0]
let created = false, roleCreated = false
let original: Record<string,unknown>[] = []

before(async () => {
  assert.equal((await control.query("SELECT count(*)::integer n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0,'Do not reuse an existing database')
  await control.query('CREATE DATABASE xmartmenu'); created = true
  await control.query('CREATE ROLE xmartmenu_waiter_fixture NOLOGIN BYPASSRLS'); roleCreated = true
  await admin.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.restaurant_tables(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id));
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),role text,must_change_password boolean DEFAULT false);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz,session_version integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),orders_enabled boolean,direct_orders_enabled boolean,table_management_enabled boolean);
    CREATE TABLE public.plans(id uuid PRIMARY KEY,features text[]);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),status text)`)
  const migration = await readFile(new URL('../../supabase/migrations/20261026110000_waiter_calls.sql',import.meta.url),'utf8')
  const ddl = migration.match(/CREATE TABLE IF NOT EXISTS public\.waiter_calls\s*\([\s\S]*?\r?\n\);/)?.[0]
  assert.ok(ddl); await admin.query(ddl)
  await admin.query('INSERT INTO public.tenants VALUES($1),($2)',[tenant,foreign])
  await admin.query('INSERT INTO public.restaurant_tables VALUES($1,$2)',[table,tenant])
  await admin.query("INSERT INTO public.plans VALUES($1,ARRAY['orders'])",[plan])
  await admin.query('INSERT INTO public.tenant_settings VALUES($1,false,false,false),($2,false,false,false)',[tenant,foreign])
  await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,$3,'active'),($2,$3,'active')",[tenant,foreign,plan])
  for (const [index,id] of ids.entries()) {
    await admin.query('INSERT INTO auth.users VALUES($1)',[id])
    await admin.query('INSERT INTO public.app_accounts(id,disabled_at) VALUES($1,$2)',[id,index === 5 ? new Date('2026-01-01') : null])
    await admin.query('INSERT INTO public.profiles VALUES($1,$2,$3,$4)',[id,index === 0 ? null : index === 3 ? foreign : tenant,index === 0 ? 'superadmin' : index === 1 || index === 5 ? 'store-admin' : index === 4 ? 'customer' : 'store-staff',index === 6])
  }
  original = (await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM public.profiles p JOIN public.app_accounts a USING(id) ORDER BY id')).rows
  // A fresh native actor has no Source Auth stub, before or after the proposal.
  await admin.query('INSERT INTO public.app_accounts(id) VALUES($1)',[native])
  await admin.query("INSERT INTO public.profiles VALUES($1,$2,'store-staff',false)",[native,tenant])
  await admin.query(`INSERT INTO public.waiter_calls(id,tenant_id,table_id,table_name,created_at,last_called_at)
    VALUES($1,$2,$3,'Table 1',$4,$4),($5,$6,NULL,'Foreign',$4,$4)`,[call,tenant,table,new Date(now.getTime()-300000),foreignCall,foreign])
  await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_waiter_fixture; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_waiter_fixture')
})
after(async () => {
  await backend.end(); await admin.end()
  if (created) await control.query('DROP DATABASE xmartmenu')
  if (roleCreated) await control.query('DROP ROLE xmartmenu_waiter_fixture')
  await control.end()
})

test('native acknowledgment is blocked by canonical Auth FK and rolls back completely',async () => {
  const before = await stored()
  await assert.rejects(update('acknowledged'),{ status: 503 })
  assert.deepEqual(await stored(),before)
  await assert.rejects(backend.query('SELECT * FROM auth.users'),{ code: '42501' })
})
test('owned-only proposal refuses wrong targets and orphan UUIDs, then preserves complete rows',async () => {
  const proposal = await readFile(new URL('../../docs/proposals/native-waiter-actor-owned-only.sql',import.meta.url),'utf8')
  await assert.rejects(control.query(proposal),/Owned candidate required/); await control.query('ROLLBACK')
  const orphan = randomUUID(), orphanCall = randomUUID()
  await admin.query('INSERT INTO auth.users VALUES($1)',[orphan])
  await admin.query("INSERT INTO public.waiter_calls(id,tenant_id,table_name,acknowledged_by) VALUES($1,$2,'Orphan fixture',$3)",[orphanCall,tenant,orphan])
  await assert.rejects(admin.query(proposal),/Unreconciled waiter actor UUIDs/); await admin.query('ROLLBACK')
  await admin.query('DELETE FROM public.waiter_calls WHERE id=$1',[orphanCall]); await admin.query('DELETE FROM auth.users WHERE id=$1',[orphan])
  const before = await stored(), accounts = (await admin.query('SELECT * FROM public.app_accounts ORDER BY id')).rows
  await admin.query(proposal)
  assert.deepEqual(await stored(),before); assert.deepEqual((await admin.query('SELECT * FROM public.app_accounts ORDER BY id')).rows,accounts)
  assert.equal((await admin.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.waiter_calls'::regclass AND conname='waiter_calls_acknowledged_by_fkey'")).rows[0].definition,'FOREIGN KEY (acknowledged_by) REFERENCES app_accounts(id) ON DELETE SET NULL')
  assert.equal((await admin.query('SELECT count(*)::integer n FROM auth.users')).rows[0].n,7)
})
test('native actor records its exact UUID and keeps all original transition/timestamp semantics',async () => {
  const before = await stored()
  const ack = await update('acknowledged')
  assert.equal(ack.call.status,'acknowledged'); assert.equal(ack.call.created_at,new Date(before.created_at).toISOString())
  let row = await stored(); assert.equal(row.acknowledged_by,native); assert.deepEqual(row.acknowledged_at,now)
  const doneAt = new Date(now.getTime()+1000)
  await update('done',nativeStaff,doneAt)
  row = await stored(); assert.deepEqual(row.done_at,doneAt); assert.equal(row.acknowledged_by,native); assert.deepEqual(row.acknowledged_at,now)
  const again = new Date(now.getTime()+2000)
  await update('acknowledged',nativeStaff,again)
  row = await stored(); assert.deepEqual(row.done_at,doneAt); assert.deepEqual(row.acknowledged_at,again)
  assert.deepEqual(row.created_at,before.created_at); assert.deepEqual(row.last_called_at,before.last_called_at)
})
test('tenant/role/account rechecks reject foreign, customer, disabled and recovery actors',async () => {
  await assert.rejects(update('done',foreignStaff),{ status: 404 })
  await assert.rejects(update('done',{ ...foreignStaff,tenantId: tenant }),{ status: 403 })
  for (const context of [{ ...staff,actorId: ids[4],role: 'customer' as const },{ ...staff,actorId: ids[5],role: 'store-admin' as const },{ ...staff,actorId: ids[6] }]) await assert.rejects(update('done',context),{ status: 403 })
  assert.deepEqual((await read(foreignStaff)).calls.map(row => row.id),[foreignCall])
  await assert.rejects(update('open'),{ status: 400 })
})
test('GET keeps max100 oldest active calls and excludes stale/done calls even if reminded',async () => {
  for (let index=1;index<=110;index++) await admin.query(`INSERT INTO public.waiter_calls(tenant_id,table_name,created_at,last_called_at)
    VALUES($1,$2,$3,$4)`,[tenant,`List ${index}`,new Date(now.getTime()-index*60000),now])
  await admin.query(`INSERT INTO public.waiter_calls(tenant_id,table_name,status,created_at,last_called_at)
    VALUES($1,'Done','done',$2,$2)`,[tenant,now])
  const result = await read()
  assert.equal(result.calls.length,100); assert.equal(result.calls[0].table_name,'List 110'); assert.equal(result.calls.at(-1)?.table_name,'List 11')
  assert.ok(result.calls.every(row => row.status !== 'done' && row.table_name.startsWith('List ')))
  // Preserve the old gte+LIMIT then activeCalls ordering: the exact two-hour
  // row can occupy a SQL slot, but is removed by the strict active filter.
  await admin.query(`INSERT INTO public.waiter_calls(tenant_id,table_name,created_at,last_called_at)
    VALUES($1,'Exact stale boundary',$2,$3)`,[tenant,new Date(now.getTime()-CALL_STALE_MS),now])
  const boundary = await read()
  assert.equal(boundary.calls.length,99)
  assert.ok(boundary.calls.every(row => row.table_name !== 'Exact stale boundary'))
  assert.equal((await read({ tenantId: tenant,actorId: ids[0],role: 'superadmin' })).calls.length,99)
})
test('current plan revocation blocks GET/PATCH while switch-off alone preserves outstanding-call handling',async () => {
  const before = await stored()
  await read() // all ordering switches are off; Orders still grants KDS handling.
  await admin.query("UPDATE public.tenant_subscriptions SET status='past_due' WHERE tenant_id=$1",[tenant])
  try { await assert.rejects(read(),{ status: 403 }); await assert.rejects(update('done'),{ status: 403 }) }
  finally { await admin.query("UPDATE public.tenant_subscriptions SET status='active' WHERE tenant_id=$1",[tenant]) }
  assert.deepEqual(await stored(),before)
})
test('late database failure rolls back all call state and app-account deletion retains SET NULL semantics',async () => {
  const before = await stored()
  await admin.query("ALTER TABLE public.waiter_calls ADD CONSTRAINT fixture_done_failure CHECK(status<>'done') NOT VALID")
  try { await assert.rejects(update('done'),{ status: 503 }) }
  finally { await admin.query('ALTER TABLE public.waiter_calls DROP CONSTRAINT fixture_done_failure') }
  assert.deepEqual(await stored(),before)
  await admin.query('DELETE FROM public.app_accounts WHERE id=$1',[native])
  assert.deepEqual(await stored(),{ ...before,acknowledged_by: null })
  assert.deepEqual((await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM public.profiles p JOIN public.app_accounts a USING(id) WHERE p.id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,original)
  assert.equal((await admin.query('SELECT count(*)::integer n FROM auth.users')).rows[0].n,7)
})
