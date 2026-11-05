// Explicit loopback disposable CI only. Never loads .env or connects to Source.
import { before,after,test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { NativeRegistration, RegistrationConflict } from '../../src/lib/auth/native-registration'
import { nativeOnboarding } from '../../src/lib/auth/native-onboarding'
import type { VerifiedGoogleIdentity } from '../../src/lib/auth/google-identity'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable target required')
const target = new URL(raw)
if (!['localhost','127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Disposable target required')
const control = new pg.Pool({ connectionString: raw,max: 1 })
const candidate = new URL(target); candidate.pathname = '/xmartmenu'
const admin = new pg.Pool({ connectionString: candidate.href,max: 2,statement_timeout: 5000 })
const backend = new pg.Pool({ connectionString: candidate.href,max: 2,statement_timeout: 5000,options: '-c role=xmartmenu_runtime' })
const ids = Array.from({ length: 7 },() => randomUUID())
let created = false
const identity = (subject: string,phone?: string): VerifiedGoogleIdentity => ({ projectId: 'test-project',subject,provider: phone ? 'phone' : 'google.com',phone,authenticatedAt: Math.floor(Date.now()/1000) })
const registration = new NativeRegistration(backend,'test-project',async id => ({ disabled: false,validSince: 0,phoneE164: id.phone ?? null }))
const counts = async () => (await admin.query(`SELECT (SELECT count(*)::int FROM public.profiles) profiles,(SELECT count(*)::int FROM public.app_accounts) accounts,(SELECT count(*)::int FROM public.app_identity_bindings) bindings,(SELECT count(*)::int FROM public.app_sessions) sessions`)).rows[0]

before(async () => {
  assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0,'Must not reuse an existing database')
  await control.query('CREATE DATABASE xmartmenu'); created = true
  await control.query('CREATE ROLE xmartmenu_runtime NOLOGIN BYPASSRLS')
  await admin.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,role text NOT NULL DEFAULT 'store-admin',tenant_id uuid,full_name text,phone text,must_change_password boolean DEFAULT false);
    CREATE TABLE public.tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,slug text UNIQUE,plan text);
    CREATE TABLE public.tenant_settings(tenant_id uuid UNIQUE REFERENCES public.tenants(id),phone text,address text,primary_color text,accent_color text);
    CREATE TABLE public.plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text,is_active boolean);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid UNIQUE REFERENCES public.tenants(id),plan_id uuid REFERENCES public.plans(id),billing_cycle text,status text);
    CREATE TABLE public.menus(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES public.tenants(id),name text,slug text,language text,supported_languages text[],purpose text,is_active boolean,is_default boolean,position int DEFAULT 0);
    CREATE TABLE public.categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,menu_id uuid REFERENCES public.menus(id),name text,position int,is_active boolean);
    CREATE TABLE public.products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,menu_id uuid REFERENCES public.menus(id),category_id uuid REFERENCES public.categories(id),name text,price numeric,is_available boolean,is_featured boolean,position int)`)
  for (const name of ['20261103190000_application_identity','20261103200000_identity_session_provenance','20261103210000_identity_browser_challenges','20261027096000_atomic_onboarding']) {
    await admin.query(await readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'))
  }
  for (const [index,id] of ids.entries()) {
    await admin.query('INSERT INTO auth.users(id) VALUES($1)',[id])
    await admin.query('INSERT INTO public.profiles(id,role,full_name,phone) VALUES($1,$2,$3,$4)',[id,index === 0 ? 'superadmin' : 'customer','Synthetic',index === 1 ? '+1 (555) 000-0001' : null])
    await admin.query('INSERT INTO public.app_accounts(id,disabled_at) VALUES($1,$2)',[id,index === 6 ? new Date('2026-01-01') : null])
  }
  await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_runtime')
})
after(async () => {
  await backend.end()
  await admin.end()
  if (created) { await control.query('DROP DATABASE xmartmenu'); await control.query('DROP ROLE xmartmenu_runtime') }
  await control.end()
})

test('legacy FK blocks fresh UUID with full rollback; proposed owned SQL preserves all seven rows',async () => {
  const before = await counts()
  await assert.rejects(registration.create(identity('before-schema'),'New Name','customer'),{ code: '23503' })
  assert.deepEqual(await counts(),before)
  const snapshot = (await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM public.profiles p JOIN public.app_accounts a USING(id) ORDER BY id')).rows
  await admin.query(await readFile(new URL('../../docs/proposals/native-registration-owned-only.sql',import.meta.url),'utf8'))
  assert.deepEqual((await admin.query('SELECT p.*,a.disabled_at,a.session_version FROM public.profiles p JOIN public.app_accounts a USING(id) ORDER BY id')).rows,snapshot)
  assert.equal((await admin.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,7)
  await assert.rejects(backend.query('SELECT * FROM auth.users'),{ code: '42501' })
})
test('fresh phone and Google get new server UUID, fixed roles, no tenant and hashed sessions',async () => {
  for (const [factor,kind] of [[identity('new-phone','+15550000002'),'customer'],[identity('new-google'),'business']] as const) {
    const result = await registration.create(factor,'New Name',kind)
    const row = (await admin.query(`SELECT p.*,b.provider,b.binding_proof,s.token_hash FROM public.profiles p JOIN public.app_identity_bindings b ON b.user_id=p.id JOIN public.app_sessions s ON s.user_id=p.id WHERE b.subject=$1`,[factor.subject])).rows[0]
    assert.ok(!ids.includes(row.id)); assert.notEqual(row.id,factor.subject)
    assert.equal(row.role,kind === 'customer' ? 'customer' : 'store-admin'); assert.equal(row.tenant_id,null)
    assert.equal(row.binding_proof,'native-registration'); assert.equal(row.provider,factor.provider)
    assert.match(row.token_hash,/^[a-f0-9]{64}$/); assert.notEqual(row.token_hash,result.token)
  }
  assert.equal((await admin.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,7)
})
test('bound/disabled binding and contact encounters never link existing account or edit IDs',async () => {
  const before = await counts()
  await assert.rejects(registration.create(identity('new-phone','+15550000002'),'Duplicate','business'),RegistrationConflict)
  await assert.rejects(registration.create(identity('same-contact','+15550000001'),'Duplicate','business'),RegistrationConflict)
  await admin.query("UPDATE public.app_identity_bindings SET disabled_at=now() WHERE subject='new-phone'")
  await assert.rejects(registration.create(identity('new-phone','+15550000002'),'Duplicate','customer'),RegistrationConflict)
  assert.deepEqual(await counts(),before)
})
test('concurrent fresh signup creates exactly one UUID and binding',async () => {
  const results = await Promise.allSettled([registration.create(identity('concurrent'),'One','customer'),registration.create(identity('concurrent'),'Two','business')])
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1)
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.app_identity_bindings WHERE subject='concurrent'")).rows[0].n,1)
})
test('late session failure rolls back profile account and binding',async () => {
  const before = await counts()
  await admin.query('ALTER TABLE public.app_sessions ADD CONSTRAINT fixture_session_failure CHECK(false) NOT VALID')
  try { await assert.rejects(registration.create(identity('rollback'),'Rollback','customer'),{ code: '23514' }) }
  finally { await admin.query('ALTER TABLE public.app_sessions DROP CONSTRAINT fixture_session_failure') }
  assert.deepEqual(await counts(),before)
})
test('canonical onboarding rolls back a missing entry plan then converges on retry',async () => {
  const uid = (await admin.query("SELECT user_id FROM public.app_identity_bindings WHERE subject='new-google'")).rows[0].user_id
  const sessionHash=(await admin.query('SELECT token_hash FROM public.app_sessions WHERE user_id=$1',[uid])).rows[0].token_hash
  const input = { company_name: 'Synthetic Restaurant',tenant_slug: 'synthetic',menu_name: 'Lunch',menu_slug: 'lunch',menu_purpose: 'restaurant',category_name: 'Food',product_name: 'Soup',product_price: 12,primary_color: '#F52323',accent_color: '#09090b' }
  const run = async () => {
    const client = await backend.connect()
    try { await client.query('BEGIN'); const result = await nativeOnboarding((sql,values) => client.query(sql,values),uid,sessionHash,input); await client.query('COMMIT'); return result }
    catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  await assert.rejects(run(),{ code: 'P0500' })
  assert.equal((await admin.query('SELECT count(*)::int n FROM public.tenants')).rows[0].n,0)
  await admin.query("INSERT INTO public.plans(slug,is_active) VALUES('menu',true)")
  const one = await run(), two = await run()
  assert.ok('tenant_id' in one && 'tenant_id' in two); assert.equal(one.tenant_id,two.tenant_id)
  assert.equal(one.created_tenant,true); assert.equal(two.created_tenant,false)
  for (const table of ['tenants','tenant_settings','tenant_subscriptions','menus','categories','products']) assert.equal((await admin.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n,1)
  assert.equal((await admin.query('SELECT role FROM public.profiles WHERE id=$1',[uid])).rows[0].role,'store-admin')
})
