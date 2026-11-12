// Explicit loopback disposable CI only. Never loads .env or connects to Source.
import { before,after,beforeEach,test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID,createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import type { AdminMenuQuery } from '../../src/lib/data/admin-menus'
import {
  AccessRequestError,abandonedDrafts,approveAccessRequest,declineAccessRequest,markAbandonedNotified,readApplicantState,
  reopenAccessRequest,saveAccessRequestDraft,submitAccessRequest,type ApplicantContext,
} from '../../src/lib/access-requests/store'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable target required')
const target = new URL(raw)
if (!['localhost','127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Disposable target required')
const control = new pg.Pool({ connectionString: raw,max: 1 })
const candidate = new URL(target); candidate.pathname = '/xmartmenu'
const admin = new pg.Pool({ connectionString: candidate.href,max: 2,statement_timeout: 5000 })
const backend = new pg.Pool({ connectionString: candidate.href,max: 4,statement_timeout: 5000,options: '-c role=xmartmenu_runtime' })
const planId = randomUUID()
let created = false,runtimeCreated = false
const createdRoles: string[] = []

type Account = { id: string; hash: string; context: ApplicantContext & { actorId: string } }
/** A live account: profile, app account, identity binding and a current session. */
async function account(role: string,name: string,tenantId: string | null = null): Promise<Account> {
  const id = randomUUID(),hash = createHash('sha256').update(`session-${id}`).digest('hex')
  await admin.query('INSERT INTO app_accounts(id) VALUES($1)',[id])
  await admin.query('INSERT INTO profiles(id,role,tenant_id,full_name,phone) VALUES($1,$2,$3,$4,$5)',[id,role,tenantId,name,'+15550001111'])
  await admin.query("INSERT INTO app_identity_bindings VALUES('skaleclub',$1,$2,'google.com',NULL)",[`subject-${id}`,id])
  await admin.query("INSERT INTO app_sessions VALUES($1,$2,0,now(),now()+interval '1 hour','skaleclub',$3)",[hash,id,`subject-${id}`])
  return { id,hash,context: { userId: id,sessionHash: hash,actorId: id } }
}
/** One transaction on the runtime role, the way the app runs a store function. */
async function tx<T>(fn: (query: AdminMenuQuery) => Promise<T>): Promise<T> {
  const client = await backend.connect()
  try {
    await client.query('BEGIN')
    const result = await fn((text,values) => client.query(text,values))
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
const applicantOf = (a: Account): ApplicantContext => ({ userId: a.id,sessionHash: a.hash })
const adminOf = (a: Account) => ({ actorId: a.id,sessionHash: a.hash })
const answers = { language: 'en',businessName: 'Cafe Sol',businessType: 'restaurant',location: 'Miami, FL',contactPhone: '+1 555 010 0001' }
const submitInput = { answers,whatsappOptIn: true }
const count = async (sql: string,values: unknown[] = []) => (await admin.query(`SELECT count(*)::int n FROM ${sql}`,values)).rows[0].n as number
const requestOf = async (userId: string) => (await admin.query('SELECT * FROM access_requests WHERE user_id=$1',[userId])).rows[0]

before(async () => {
  assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname='xmartmenu'")).rows[0].n,0,'Must not reuse an existing database')
  await control.query('CREATE DATABASE xmartmenu'); created = true
  await control.query('CREATE ROLE xmartmenu_runtime NOLOGIN BYPASSRLS'); runtimeCreated = true
  // The migration revokes from and grants to the Supabase roles, which must exist.
  for (const name of ['anon','authenticated','service_role']) {
    if (!(await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount) { await control.query(`CREATE ROLE ${name} NOLOGIN`); createdRoles.push(name) }
  }
  await admin.query(`CREATE TABLE tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text UNIQUE NOT NULL,plan text,is_active boolean DEFAULT true,created_at timestamptz DEFAULT now());
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text,tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,full_name text,phone text,must_change_password boolean DEFAULT false,created_at timestamptz DEFAULT now());
    CREATE TABLE app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz,session_version int NOT NULL DEFAULT 0);
    CREATE TABLE app_identity_bindings(project_id text,subject text,user_id uuid REFERENCES app_accounts(id),provider text,disabled_at timestamptz,PRIMARY KEY(project_id,subject));
    CREATE TABLE app_sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES app_accounts(id),session_version int,authenticated_at timestamptz,expires_at timestamptz,project_id text,subject text);
    CREATE TABLE plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,slug text UNIQUE,features jsonb DEFAULT '[]',is_active boolean DEFAULT true);
    CREATE TABLE tenant_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,orders_enabled boolean DEFAULT false,direct_orders_enabled boolean DEFAULT false,dine_in_enabled boolean DEFAULT false,table_management_enabled boolean DEFAULT false);
    CREATE TABLE tenant_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,plan_id uuid REFERENCES plans(id) ON DELETE RESTRICT,billing_cycle text,status text);
    CREATE TABLE menus(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,name text,slug text,language text,supported_languages text[],purpose text,is_active boolean,is_default boolean,position int,created_at timestamptz DEFAULT now());
    CREATE TABLE audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,occurred_at timestamptz NOT NULL DEFAULT now(),tenant_id uuid,actor_id uuid,via text NOT NULL,table_name text NOT NULL,record_id text,action text NOT NULL,changes jsonb NOT NULL DEFAULT '{}'::jsonb,request_id text)`)
  await admin.query(await readFile(new URL('../../docs/proposals/native-tenant-effects-owned-only.sql',import.meta.url),'utf8'))
  await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO xmartmenu_runtime')
  // The real migration last: it grants SELECT,INSERT,UPDATE to the runtime role itself.
  await admin.query(await readFile(new URL('../../supabase/migrations/20261112210000_access_requests.sql',import.meta.url),'utf8'))
})
beforeEach(async () => {
  await admin.query('TRUNCATE access_requests,app_tenant_effects,app_sessions,app_identity_bindings,app_accounts,profiles,tenant_settings,tenant_subscriptions,menus,tenants,plans CASCADE; TRUNCATE audit_events')
  await admin.query("INSERT INTO plans(id,name,slug,features) VALUES($1,'Menu','menu','[\"orders\"]')",[planId])
})
after(async () => {
  await backend.end()
  await admin.end()
  if (created) await control.query('DROP DATABASE xmartmenu')
  if (runtimeCreated) await control.query('DROP ROLE xmartmenu_runtime')
  for (const name of createdRoles) await control.query(`DROP ROLE ${name}`)
  await control.end()
})

test('a business account without a restaurant starts as none with prefill; autosaving twice keeps one draft',async () => {
  const a = await account('store-admin','Ana Owner')
  const state = await tx(q => readApplicantState(q,applicantOf(a)))
  assert.equal(state.status,'none')
  assert.ok('prefill' in state); assert.deepEqual(state.prefill,{ fullName: 'Ana Owner',phone: '+15550001111' })
  await tx(q => saveAccessRequestDraft(q,applicantOf(a),{ step: 'businessName',answers: { language: 'pt' } }))
  await tx(q => saveAccessRequestDraft(q,applicantOf(a),{ step: 'location',answers: { language: 'pt',businessName: 'Cafe Sol' } }))
  assert.equal(await count('access_requests WHERE user_id=$1',[a.id]),1)
  const row = await requestOf(a.id)
  assert.equal(row.status,'draft'); assert.equal(row.step,'location'); assert.deepEqual(row.answers,{ language: 'pt',businessName: 'Cafe Sol' })
  const after = await tx(q => readApplicantState(q,applicantOf(a)))
  assert.ok('step' in after); assert.equal(after.status,'draft'); assert.equal(after.step,'location')
})

test('submit goes pending once with an audit event; repeats return the same request without a lead; drafts are then locked',async () => {
  const a = await account('store-admin','Ana Owner')
  const first = await tx(q => submitAccessRequest(q,applicantOf(a),submitInput))
  assert.equal(first.status,'pending'); assert.ok(first.lead); assert.equal(first.lead!.requestId,first.requestId)
  assert.equal(first.lead!.name,'Ana Owner'); assert.equal(first.lead!.answers.businessName,'Cafe Sol')
  assert.equal(await count("audit_events WHERE table_name='access_requests' AND record_id=$1 AND changes->>'operation'='access_request_submitted'",[first.requestId]),1)
  const second = await tx(q => submitAccessRequest(q,applicantOf(a),submitInput))
  assert.equal(second.requestId,first.requestId); assert.equal(second.lead,null)
  assert.equal(await count('audit_events'),1)
  await assert.rejects(tx(q => saveAccessRequestDraft(q,applicantOf(a),{ step: 'location',answers: {} })),(error: unknown) => error instanceof AccessRequestError && error.status === 409)
})

test('concurrent submits create exactly one pending request and exactly one lead',async () => {
  const a = await account('store-admin','Ana Owner')
  const results = await Promise.all([1,2,3].map(() => tx(q => submitAccessRequest(q,applicantOf(a),submitInput))))
  assert.equal(await count("access_requests WHERE user_id=$1 AND status='pending'",[a.id]),1)
  assert.equal(await count('access_requests'),1)
  assert.equal(results.filter(r => r.lead !== null).length,1)
  assert.equal(new Set(results.map(r => r.requestId)).size,1)
})

test('submitting never changes the profile role or restaurant',async () => {
  const a = await account('store-admin','Ana Owner')
  const before = (await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[a.id])).rows[0]
  await tx(q => submitAccessRequest(q,applicantOf(a),submitInput))
  assert.deepEqual((await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[a.id])).rows[0],before)
  assert.equal(before.tenant_id,null)
})

test('customer, superadmin, expired and unknown sessions cannot read applicant state',async () => {
  const customer = await account('customer','Cus'),boss = await account('superadmin','Boss'),a = await account('store-admin','Ana Owner')
  const forbidden = (error: unknown) => error instanceof AccessRequestError && error.status === 403
  await assert.rejects(tx(q => readApplicantState(q,applicantOf(customer))),forbidden)
  await assert.rejects(tx(q => readApplicantState(q,applicantOf(boss))),forbidden)
  await assert.rejects(tx(q => readApplicantState(q,{ userId: a.id,sessionHash: 'a'.repeat(64) })),forbidden)
  await admin.query("UPDATE app_sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1",[a.id])
  await assert.rejects(tx(q => readApplicantState(q,applicantOf(a))),forbidden)
})

test('approving as a new restaurant links the applicant, revokes sessions and is final; a non-superadmin is refused',async () => {
  const boss = await account('superadmin','Boss'),a = await account('store-admin','Ana Owner'),other = await account('store-admin','Other')
  const pending = await tx(q => submitAccessRequest(q,applicantOf(a),submitInput))
  const input = { mode: 'new',name: 'Cafe Sol',slug: 'cafe-sol',plan_id: planId }
  await assert.rejects(tx(q => approveAccessRequest(q,adminOf(other),pending.requestId,input)),{ status: 403 })
  assert.equal((await requestOf(a.id)).status,'pending')
  const result = await tx(q => approveAccessRequest(q,adminOf(boss),pending.requestId,input))
  assert.equal(result.createdTenant,true); assert.equal(result.request.status,'approved'); assert.equal(result.request.tenant_id,result.tenantId)
  const row = await requestOf(a.id)
  assert.equal(row.status,'approved'); assert.equal(row.tenant_id,result.tenantId); assert.equal(row.reviewed_by,boss.id)
  assert.deepEqual((await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[a.id])).rows[0],{ role: 'store-admin',tenant_id: result.tenantId })
  assert.equal(await count('tenants WHERE id=$1',[result.tenantId]),1)
  assert.equal(await count('tenant_subscriptions WHERE tenant_id=$1',[result.tenantId]),1)
  assert.equal(await count('app_sessions WHERE user_id=$1',[a.id]),0)
  await assert.rejects(tx(q => approveAccessRequest(q,adminOf(boss),pending.requestId,input)),{ status: 409 })
})

test('approving into an existing restaurant is refused when it has an administrator and works when it is empty',async () => {
  const boss = await account('superadmin','Boss'),a = await account('store-admin','Ana Owner')
  const taken = randomUUID(),empty = randomUUID()
  await admin.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Taken','taken'),($2,'Empty','empty')",[taken,empty])
  await account('store-admin','Incumbent',taken)
  const pending = await tx(q => submitAccessRequest(q,applicantOf(a),submitInput))
  await assert.rejects(tx(q => approveAccessRequest(q,adminOf(boss),pending.requestId,{ mode: 'existing',tenant_id: taken })),{ status: 409 })
  assert.equal((await requestOf(a.id)).status,'pending')
  const result = await tx(q => approveAccessRequest(q,adminOf(boss),pending.requestId,{ mode: 'existing',tenant_id: empty }))
  assert.equal(result.createdTenant,false); assert.equal(result.tenantId,empty); assert.equal(result.request.status,'approved')
  assert.deepEqual((await admin.query('SELECT role,tenant_id FROM profiles WHERE id=$1',[a.id])).rows[0],{ role: 'store-admin',tenant_id: empty })
  assert.equal(await count('app_sessions WHERE user_id=$1',[a.id]),0)
})

test('declining records the note and reopening returns the request to pending',async () => {
  const boss = await account('superadmin','Boss'),a = await account('store-admin','Ana Owner')
  const pending = await tx(q => submitAccessRequest(q,applicantOf(a),submitInput))
  const declined = await tx(q => declineAccessRequest(q,adminOf(boss),pending.requestId,{ note: 'Not a fit' }))
  assert.equal(declined.request.status,'declined'); assert.equal(declined.request.decision_note,'Not a fit')
  const reopened = await tx(q => reopenAccessRequest(q,adminOf(boss),pending.requestId))
  assert.equal(reopened.request.status,'pending'); assert.equal(reopened.request.reviewed_at,null)
  assert.equal((await requestOf(a.id)).status,'pending')
})

test('an idle draft is listed once as abandoned and is announced exactly once',async () => {
  const a = await account('store-admin','Ana Owner')
  await tx(q => saveAccessRequestDraft(q,applicantOf(a),{ step: 'businessName',answers: { language: 'en' } }))
  assert.equal((await tx(q => abandonedDrafts(q))).length,0)
  await admin.query("UPDATE access_requests SET last_activity_at=now()-interval '2 hours' WHERE user_id=$1",[a.id])
  const listed = await tx(q => abandonedDrafts(q))
  assert.equal(listed.length,1); assert.equal(listed[0].full_name,'Ana Owner')
  const id = listed[0].id
  assert.equal(await tx(q => markAbandonedNotified(q,id)),true)
  assert.equal(await tx(q => markAbandonedNotified(q,id)),false)
  assert.equal((await tx(q => abandonedDrafts(q))).length,0)
})
