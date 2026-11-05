// Explicit loopback disposable CI only. Never loads .env or connects to Source.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { IdentityStore } from '../../src/lib/auth/identity-store'
import { planClaims } from '../../scripts/ops/import-google-subject-claims'
import { migrationSources, nativeIdentityProjection } from '../../scripts/ops/prepare-xmartmenu-identity-foundation.mjs'
import type { VerifiedGoogleIdentity } from '../../src/lib/auth/google-identity'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable target required')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Disposable target required')
const control = new pg.Pool({ connectionString: raw, max: 1 })
const candidate = new URL(target); candidate.pathname = '/xmartmenu'
const admin = new pg.Pool({ connectionString: candidate.href, max: 2, statement_timeout: 5000 })
// The restricted native runtime: only what the reviewed projection grants it.
const backend = new pg.Pool({ connectionString: candidate.href, max: 3, statement_timeout: 5000, options: '-c role=xmartmenu_runtime' })
const createdRoles: string[] = []
let created = false
const now = () => Math.floor(Date.now() / 1000)
const google = (subject: string, googleSubject?: string): VerifiedGoogleIdentity => ({ projectId: 'test-project', subject, provider: 'google.com', googleSubject, email: 'same@example.test', authenticatedAt: now() })
const phoneId = (subject: string, phone: string): VerifiedGoogleIdentity => ({ projectId: 'test-project', subject, provider: 'phone', phone, authenticatedAt: now() })
const active = async () => ({ disabled: false, validSince: 0 })
const store = new IdentityStore(backend, active, async id => ({ disabled: false, validSince: 0, phoneE164: (id as VerifiedGoogleIdentity).phone ?? null }))
const names = ['ok', 'disabled', 'customer', 'dupA', 'dupB', 'brazil', 'peru', 'admin', 'adminShared', 'sharedCustomer', 'forced', 'bound']
const ids = Object.fromEntries(names.map(k => [k, randomUUID()])) as Record<string, string>
const SUB = '100000000000000001'

before(async () => {
  for (const [name, options] of [['authenticated', 'NOLOGIN'], ['service_role', 'NOLOGIN BYPASSRLS'],
    ['xmartmenu_runtime', 'NOLOGIN BYPASSRLS'], ['xmartmenu_staging_reader', 'NOLOGIN BYPASSRLS']]) {
    if (!(await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount) { await control.query(`CREATE ROLE ${name} ${options}`); createdRoles.push(name) }
  }
  await control.query('CREATE DATABASE xmartmenu'); created = true
  await admin.query("CREATE TABLE public.profiles(id uuid PRIMARY KEY, phone text, role text NOT NULL DEFAULT 'customer', must_change_password boolean DEFAULT false)")
  // Exactly what the host applies: the reviewed, pinned native projection.
  await admin.query(nativeIdentityProjection(await migrationSources()).sql)
  await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_runtime; GRANT SELECT ON public.profiles TO xmartmenu_runtime')
  for (const id of Object.values(ids)) await admin.query('INSERT INTO public.app_accounts(id, disabled_at) VALUES($1,$2)', [id, id === ids.disabled ? new Date('2026-01-01') : null])
  const rows: [string, string | null, string, boolean][] = [
    [ids.customer, '+1 (555) 123-4567', 'customer', false], [ids.dupA, '+55 11 90000-0001', 'customer', false], [ids.dupB, '+55 11 90000-0001', 'customer', false],
    [ids.brazil, '(51) 99123-4567', 'customer', false], [ids.peru, '+51 991 234 567', 'customer', false],
    [ids.admin, '+1 555 777 0001', 'store-admin', false], [ids.adminShared, '+1 555 777 0002', 'store-admin', false], [ids.sharedCustomer, '+1 555 777 0002', 'customer', false],
    [ids.forced, '+1 555 777 0003', 'customer', true], [ids.bound, '+1 555 777 0004', 'customer', false],
  ]
  for (const [id, phone, role, forced] of rows) await admin.query('INSERT INTO public.profiles(id,phone,role,must_change_password) VALUES($1,$2,$3,$4)', [id, phone, role, forced])
  await admin.query("INSERT INTO public.app_identity_bindings(project_id,subject,user_id,provider,binding_proof) VALUES('test-project','existing-binding',$1,'google.com','legacy-session')", [ids.bound])
})
after(async () => {
  await backend.end(); await admin.end()
  if (created) await control.query('DROP DATABASE xmartmenu')
  for (const name of createdRoles.reverse()) await control.query(`DROP ROLE ${name}`)
  await control.end()
})

test('the native projection applies and the restricted runtime reads claims but cannot write unrelated tables', async () => {
  const grants = (await admin.query(`SELECT has_table_privilege('xmartmenu_runtime','public.identity_google_subject_claims','SELECT') AS read,
    has_table_privilege('xmartmenu_runtime','public.app_identity_bindings','INSERT') AS bind`)).rows[0]
  assert.deepEqual(grants, { read: true, bind: true })
  assert.equal(await store.googleClaim('not-claimed'), null)
  await assert.rejects(backend.query('INSERT INTO public.profiles(id) VALUES(gen_random_uuid())'), { code: '42501' })
})

test('claims table is closed to browser roles and only accepts the reviewed source', async () => {
  const c = await admin.connect()
  try {
    await c.query('SET ROLE authenticated')
    await assert.rejects(c.query('SELECT * FROM public.identity_google_subject_claims'), { code: '42501' })
    await c.query('RESET ROLE')
    if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='anon'")).rowCount) {
      await c.query('SET ROLE anon')
      await assert.rejects(c.query('SELECT * FROM public.identity_google_subject_claims'), { code: '42501' })
      await c.query('RESET ROLE')
    }
  } finally { await c.query('RESET ROLE'); c.release() }
  await assert.rejects(admin.query("INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source) VALUES('x',$1,'manual')", [ids.ok]), { code: '23514' })
})

test('importer plan keeps only exact app UIDs, never e-mail, and is idempotent', async () => {
  const users = [
    { id: ids.ok, email: 'a@example.test', identities: [{ provider: 'google', provider_id: SUB, identity_data: { sub: SUB } }] },
    { id: randomUUID(), email: 'a@example.test', identities: [{ provider: 'google', provider_id: '100000000000000002' }] },
    { id: ids.disabled, identities: [{ provider: 'email', provider_id: 'x' }] },
  ]
  const plan = planClaims(users, new Set([ids.ok, ids.disabled]))
  assert.deepEqual(plan.claims, [{ googleSub: SUB, accountId: ids.ok }])
  assert.deepEqual({ skippedNoAccount: plan.skippedNoAccount, skippedNoGoogle: plan.skippedNoGoogle }, { skippedNoAccount: 1, skippedNoGoogle: 1 })
  for (let i = 0; i < 2; i++) {
    for (const claim of plan.claims) await admin.query("INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source) VALUES($1,$2,'supabase-auth-import') ON CONFLICT DO NOTHING", [claim.googleSub, claim.accountId])
  }
  assert.equal((await admin.query('SELECT count(*)::int n FROM public.identity_google_subject_claims')).rows[0].n, 1)
})

test('an imported subject binds as google-subject and opens a session; an unclaimed subject cannot be bound', async () => {
  assert.deepEqual(await store.googleClaim(SUB), { userId: ids.ok, disabled: false })
  assert.equal(await store.googleClaim('someone-else'), null)
  const id = google('fb-ok', SUB)
  await store.bind(id, ids.ok, 'google-subject')
  assert.equal(await store.owner(id), ids.ok)
  assert.equal((await admin.query('SELECT binding_proof FROM public.app_identity_bindings WHERE subject=$1', ['fb-ok'])).rows[0].binding_proof, 'google-subject')
  assert.ok((await store.createSession(id)).token)
  await assert.rejects(store.bind(google('fb-forged', 'sub-forged'), ids.ok, 'google-subject'), /not claimed/)
  await assert.rejects(store.bind(google('fb-wrong', SUB), ids.customer, 'google-subject'), /not claimed/)
  assert.equal(await store.owner(google('fb-forged', 'sub-forged')), null)
})

test('a claim on a disabled account is reported disabled and cannot bind', async () => {
  await admin.query("INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source) VALUES('sub-disabled',$1,'supabase-auth-import')", [ids.disabled])
  assert.deepEqual(await store.googleClaim('sub-disabled'), { userId: ids.disabled, disabled: true })
  await assert.rejects(store.bind(google('fb-disabled', 'sub-disabled'), ids.disabled, 'google-subject'))
  assert.equal(await store.owner(google('fb-disabled', 'sub-disabled')), null)
})

test('phone owners need an explicit + and E.164 equality: a national number never matches another country', async () => {
  assert.deepEqual(await store.phoneOwners('+15551234567'), [{ userId: ids.customer, disabled: false }])
  // (51) 99123-4567 and +51 991 234 567 have the same digits, 51991234567.
  assert.deepEqual(await store.phoneOwners('+51991234567'), [{ userId: ids.peru, disabled: false }])
  await admin.query('DELETE FROM public.profiles WHERE id=$1', [ids.peru])
  assert.deepEqual(await store.phoneOwners('+51991234567'), [], 'the national-format row must not match')
  await admin.query("INSERT INTO public.profiles(id,phone,role) VALUES($1,'+51 991 234 567','customer')", [ids.peru])
  assert.equal((await store.phoneOwners('+5511900000001')).length, 2)
  assert.deepEqual(await store.phoneOwners('+15550000000'), [])
  assert.deepEqual(await store.phoneOwners('5551234567'), [])
  assert.deepEqual(await store.phoneOwners('123'), [])
})

test('phone sign-in is only for unbound customers: staff, admin, forced-reset and bound accounts never match', async () => {
  assert.deepEqual(await store.phoneOwners('+15557770001'), [], 'store-admin public business phone')
  assert.deepEqual(await store.phoneOwners('+15557770003'), [], 'must change password')
  assert.deepEqual(await store.phoneOwners('+15557770004'), [], 'already has an active binding')
  assert.equal((await store.phoneOwners('+15557770002')).length, 2, 'admin and customer sharing a number stay ambiguous')
})

test('phone-match binds only the eligible unique owner with current provider phone', async () => {
  const id = phoneId('fb-phone', '+15551234567')
  await store.bind(id, ids.customer, 'phone-match')
  assert.equal(await store.owner(id), ids.customer)
  await assert.rejects(store.bind(phoneId('fb-phone-other', '+15551234567'), ids.ok, 'phone-match'), /eligible account/)
  await assert.rejects(store.bind(phoneId('fb-dup', '+5511900000001'), ids.dupA, 'phone-match'), /eligible account/)
  await assert.rejects(store.bind(phoneId('fb-admin', '+15557770001'), ids.admin, 'phone-match'), /eligible account/)
  await assert.rejects(store.bind(phoneId('fb-forced', '+15557770003'), ids.forced, 'phone-match'), /eligible account/)
  const stale = new IdentityStore(backend, active, async () => ({ disabled: false, validSince: 0, phoneE164: '+15550000000' }))
  await assert.rejects(stale.bind(phoneId('fb-stale', '+15551234567'), ids.customer, 'phone-match'))
  await assert.rejects(new IdentityStore(backend, active).bind(phoneId('fb-nocheck', '+15551234567'), ids.customer, 'phone-match'), /phone proof/)
  assert.equal(await store.owner(phoneId('fb-admin', '+15557770001')), null)
})
