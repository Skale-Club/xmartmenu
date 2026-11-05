// Explicit loopback disposable CI only. Never loads .env or connects to Source.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { IdentityStore } from '../../src/lib/auth/identity-store'
import { planClaims } from '../../scripts/ops/import-google-subject-claims'
import type { VerifiedGoogleIdentity } from '../../src/lib/auth/google-identity'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable target required')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Disposable target required')
const control = new pg.Pool({ connectionString: raw, max: 1 })
const candidate = new URL(target); candidate.pathname = '/xmartmenu'
const admin = new pg.Pool({ connectionString: candidate.href, max: 2, statement_timeout: 5000 })
const backend = new pg.Pool({ connectionString: candidate.href, max: 3, statement_timeout: 5000, options: '-c role=xmartmenu_claims_runtime' })
let created = false
const now = () => Math.floor(Date.now() / 1000)
const google = (subject: string, googleSubject?: string): VerifiedGoogleIdentity => ({ projectId: 'test-project', subject, provider: 'google.com', googleSubject, email: 'same@example.test', authenticatedAt: now() })
const phoneId = (subject: string, phone: string): VerifiedGoogleIdentity => ({ projectId: 'test-project', subject, provider: 'phone', phone, authenticatedAt: now() })
const active = async () => ({ disabled: false, validSince: 0 })
const store = new IdentityStore(backend, active, async id => ({ disabled: false, validSince: 0, phoneE164: (id as VerifiedGoogleIdentity).phone ?? null }))
const [okAcct, disabledAcct, phoneAcct, dupA, dupB] = Array.from({ length: 5 }, () => randomUUID())

before(async () => {
  await control.query('CREATE DATABASE xmartmenu'); created = true
  await control.query('CREATE ROLE xmartmenu_claims_runtime NOLOGIN BYPASSRLS')
  // Roles are cluster-wide and other suites already create them; create only what is missing.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$`)
  await admin.query('CREATE TABLE public.profiles(id uuid PRIMARY KEY, phone text)')
  for (const name of ['20261103190000_application_identity', '20261103200000_identity_session_provenance', '20261103210000_identity_browser_challenges', '20261104090000_identity_google_claims_and_pending']) {
    await admin.query(await readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'))
  }
  await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_claims_runtime; GRANT ALL ON ALL TABLES IN SCHEMA public TO xmartmenu_claims_runtime')
  for (const id of [okAcct, disabledAcct, phoneAcct, dupA, dupB]) await admin.query('INSERT INTO public.app_accounts(id, disabled_at) VALUES($1,$2)', [id, id === disabledAcct ? new Date('2026-01-01') : null])
  await admin.query("INSERT INTO public.profiles(id, phone) VALUES($1,'+1 (555) 123-4567'),($2,'+55 11 90000-0001'),($3,'+55 11 90000-0001')", [phoneAcct, dupA, dupB])
})
after(async () => {
  await backend.end(); await admin.end()
  if (created) { await control.query('DROP DATABASE xmartmenu'); await control.query('DROP ROLE xmartmenu_claims_runtime') }
  await control.end()
})

test('claims and pending tables are closed to browser roles and rows cascade with the account', async () => {
  const c = await admin.connect()
  try {
    for (const role of ['anon', 'authenticated']) {
      await c.query(`SET ROLE ${role}`)
      await assert.rejects(c.query('SELECT * FROM public.identity_google_subject_claims'), { code: '42501' })
      await assert.rejects(c.query('SELECT * FROM public.app_identity_pending_google'), { code: '42501' })
      await c.query('RESET ROLE')
    }
  } finally { await c.query('RESET ROLE'); c.release() }
  await assert.rejects(admin.query("INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source) VALUES('x',$1,'manual')", [okAcct]))
})

test('importer plan keeps only exact app UIDs, never e-mail, and is idempotent', async () => {
  const users = [
    { id: okAcct, email: 'a@example.test', identities: [{ provider: 'google', provider_id: '100000000000000001', identity_data: { sub: '100000000000000001' } }] },
    { id: randomUUID(), email: 'a@example.test', identities: [{ provider: 'google', provider_id: '100000000000000002' }] },
    { id: disabledAcct, identities: [{ provider: 'email', provider_id: 'x' }] },
  ]
  const plan = planClaims(users, new Set([okAcct, disabledAcct]))
  assert.deepEqual(plan.claims, [{ googleSub: '100000000000000001', accountId: okAcct }])
  assert.deepEqual({ skippedNoAccount: plan.skippedNoAccount, skippedNoGoogle: plan.skippedNoGoogle }, { skippedNoAccount: 1, skippedNoGoogle: 1 })
  for (let i = 0; i < 2; i++) {
    for (const claim of plan.claims) await admin.query("INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source) VALUES($1,$2,'supabase-auth-import') ON CONFLICT DO NOTHING", [claim.googleSub, claim.accountId])
  }
  assert.equal((await admin.query('SELECT count(*)::int n FROM public.identity_google_subject_claims')).rows[0].n, 1)
})

test('an imported subject binds as google-subject and opens a session; an unclaimed subject cannot be bound', async () => {
  assert.deepEqual(await store.googleClaim('100000000000000001'), { userId: okAcct, disabled: false })
  assert.equal(await store.googleClaim('someone-else'), null)
  const id = google('fb-ok', '100000000000000001')
  await store.bind(id, okAcct, 'google-subject')
  assert.equal(await store.owner(id), okAcct)
  assert.equal((await admin.query('SELECT binding_proof FROM public.app_identity_bindings WHERE subject=$1', ['fb-ok'])).rows[0].binding_proof, 'google-subject')
  assert.ok((await store.createSession(id)).token)
  await assert.rejects(store.bind(google('fb-forged', 'sub-forged'), okAcct, 'google-subject'), /not claimed/)
  await assert.rejects(store.bind(google('fb-wrong', '100000000000000001'), phoneAcct, 'google-subject'), /not claimed/)
  assert.equal(await store.owner(google('fb-forged', 'sub-forged')), null)
})

test('a claim on a disabled account is reported disabled and cannot bind', async () => {
  await admin.query("INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source) VALUES('sub-disabled',$1,'supabase-auth-import')", [disabledAcct])
  assert.deepEqual(await store.googleClaim('sub-disabled'), { userId: disabledAcct, disabled: true })
  await assert.rejects(store.bind(google('fb-disabled', 'sub-disabled'), disabledAcct, 'google-subject'))
  assert.equal(await store.owner(google('fb-disabled', 'sub-disabled')), null)
})

test('phone owners compare digits only and a duplicated number is visible as two rows', async () => {
  assert.deepEqual(await store.phoneOwners('+15551234567'), [{ userId: phoneAcct, disabled: false }])
  assert.equal((await store.phoneOwners('+5511900000001')).length, 2)
  assert.deepEqual(await store.phoneOwners('+15550000000'), [])
  assert.deepEqual(await store.phoneOwners('123'), [])
})

test('phone-match binds only the exact unique owner with current provider phone; duplicates and mismatches are refused', async () => {
  const id = phoneId('fb-phone', '+15551234567')
  await store.bind(id, phoneAcct, 'phone-match')
  assert.equal(await store.owner(id), phoneAcct)
  await assert.rejects(store.bind(phoneId('fb-phone-other', '+15551234567'), okAcct, 'phone-match'), /exactly this account/)
  await assert.rejects(store.bind(phoneId('fb-dup', '+5511900000001'), dupA, 'phone-match'), /exactly this account/)
  const stale = new IdentityStore(backend, active, async () => ({ disabled: false, validSince: 0, phoneE164: '+15550000000' }))
  await assert.rejects(stale.bind(phoneId('fb-stale', '+15551234567'), phoneAcct, 'phone-match'))
  await assert.rejects(new IdentityStore(backend, active).bind(phoneId('fb-nocheck', '+15551234567'), phoneAcct, 'phone-match'), /phone proof/)
})

test('pending Google lives 10 minutes, is single use, and joins the account the phone proved', async () => {
  const g = google('fb-pending', 'sub-pending')
  const token = await store.issuePending(g)
  const row = (await admin.query("SELECT expires_at-created_at AS ttl FROM public.app_identity_pending_google")).rows[0]
  assert.equal(row.ttl.minutes, 10)
  const pending = await store.takePending(token)
  assert.deepEqual({ projectId: pending?.projectId, subject: pending?.subject }, { projectId: 'test-project', subject: 'fb-pending' })
  assert.equal(await store.takePending(token), null)
  assert.equal(await store.bindPendingGoogle(pending!, phoneAcct), true)
  assert.equal(await store.owner(g), phoneAcct)
  const expired = await store.issuePending(google('fb-expired', 'sub-expired'))
  await admin.query("UPDATE public.app_identity_pending_google SET created_at=now()-interval '11 minutes', expires_at=now()-interval '1 minute'")
  assert.equal(await store.takePending(expired), null)
  assert.equal(await store.takePending('not-a-token'), null)
})

test('pending Google never overrides an identity already owned by another account', async () => {
  const g = google('fb-owned-elsewhere', 'sub-elsewhere')
  await store.bind(g, okAcct, 'owned-session')
  assert.equal(await store.bindPendingGoogle({ projectId: g.projectId, subject: g.subject, authenticatedAt: g.authenticatedAt }, phoneAcct), false)
  assert.equal(await store.owner(g), okAcct)
})
