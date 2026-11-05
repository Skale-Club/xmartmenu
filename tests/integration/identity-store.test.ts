// Run ONLY against the disposable PostgreSQL service in CI. Never load .env.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { IdentityStore } from '../../src/lib/auth/identity-store'
import type { VerifiedGoogleIdentity } from '../../src/lib/auth/google-identity'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw new Error('IDENTITY_TEST_DATABASE_URL must explicitly select the disposable CI database')
const target = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test') throw new Error('Not an isolated identity test target')
const admin = new pg.Pool({ connectionString: raw, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })
const backend = new pg.Pool({ connectionString: raw, max: 3, options: '-c role=service_role', statement_timeout: 5_000 })
const providerState = new Map<string, { disabled: boolean; validSince: number }>()
const providerReads: string[] = []
let providerUnavailable = false
const store = new IdentityStore(backend, async id => {
  providerReads.push(id.subject)
  if (providerUnavailable) throw new Error('Provider unavailable')
  return providerState.get(id.subject) ?? { disabled: false, validSince: 0 }
})
const a = randomUUID(), b = randomUUID()
const identity = (subject: string): VerifiedGoogleIdentity => ({ projectId: 'skaleclub', subject, provider: 'phone', phone: '+15551234567', authenticatedAt: Math.floor(Date.now() / 1000) })

before(async () => {
  // Cluster-wide roles may already exist from another suite; create only what is missing.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$`)
  await admin.query(await readFile(new URL('../../supabase/migrations/20261103190000_application_identity.sql', import.meta.url), 'utf8'))
  await admin.query(await readFile(new URL('../../supabase/migrations/20261103200000_identity_session_provenance.sql', import.meta.url), 'utf8'))
  await admin.query(await readFile(new URL('../../supabase/migrations/20261103210000_identity_browser_challenges.sql', import.meta.url), 'utf8'))
  await admin.query('INSERT INTO public.app_accounts(id) VALUES($1),($2)', [a, b])
})
after(async () => { await backend.end(); await admin.end() })

test('migration does not expose identities or sessions through browser roles', async () => {
  const c = await admin.connect()
  try {
    await c.query('SET ROLE authenticated')
    await assert.rejects(c.query('SELECT * FROM public.app_identity_bindings'), { code: '42501' })
    await assert.rejects(c.query('UPDATE public.app_accounts SET session_version=1'), { code: '42501' })
    await assert.rejects(c.query('SELECT * FROM public.app_identity_challenges'), { code: '42501' })
    await c.query('SET ROLE anon')
    await assert.rejects(c.query('SELECT * FROM public.app_sessions'), { code: '42501' })
  } finally { await c.query('RESET ROLE'); c.release() }
})

test('concurrent first binding has exactly one owner, without changing IDs', async () => {
  const id = identity('concurrent')
  const outcomes = await Promise.allSettled([store.bind(id, a, 'legacy-session'), store.bind(id, b, 'legacy-session')])
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1)
  const owner = await store.owner(id)
  assert.ok(owner === a || owner === b)
  await store.bind(id, owner, 'legacy-session') // idempotent for same owner
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.app_accounts')).rows[0].count, 2)
})

test('sessions store hashes, reject unbound identities, expire and revoke', async () => {
  const id = identity('sessions')
  await assert.rejects(store.createSession(id))
  await store.bind(id, a, 'operator-recovery')
  const first = await store.createSession(id)
  assert.equal((await store.session(first.token))?.userId, a)
  assert.equal(await store.session('forged'), null)
  const hashes = (await admin.query('SELECT token_hash FROM public.app_sessions')).rows.map(r => r.token_hash)
  assert.ok(hashes.every(hash => /^[a-f0-9]{64}$/.test(hash) && hash !== first.token))
  await store.logout(first.token)
  assert.equal(await store.session(first.token), null)
  const second = await store.createSession(id)
  await store.revokeAll(a)
  assert.equal(await store.session(second.token), null)
  const third = await store.createSession(id)
  assert.equal((await store.session(third.token))?.userId, a)
  await admin.query("UPDATE public.app_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'")
  assert.equal(await store.session(third.token), null)
})

test('blocking an account prevents binding and invalidates its sessions', async () => {
  const id = identity('disabled')
  await store.bind(id, b, 'operator-recovery')
  const session = await store.createSession(id)
  await admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1', [b])
  assert.equal(await store.owner(id), null)
  assert.equal(await store.session(session.token), null)
  await assert.rejects(store.createSession(id))
  await assert.rejects(store.bind(identity('another'), b, 'legacy-session'))
})

test('an existing session checks the exact provider on every read and fails closed', async () => {
  const id = identity('live-provider')
  await store.bind(id, a, 'legacy-session')
  const session = await store.createSession(id)
  const reads = providerReads.length
  assert.equal((await store.session(session.token))?.userId, a)
  assert.equal((await store.session(session.token))?.userId, a)
  assert.deepEqual(providerReads.slice(reads), [id.subject, id.subject])
  providerState.set(id.subject, { disabled: true, validSince: 0 })
  await assert.rejects(store.session(session.token), /disabled or revoked/)
  await assert.rejects(store.createSession(id), /disabled or revoked/)
  providerState.set(id.subject, { disabled: false, validSince: id.authenticatedAt + 1 })
  await assert.rejects(store.session(session.token), /disabled or revoked/)
  providerState.delete(id.subject)
  providerUnavailable = true
  try { await assert.rejects(store.session(session.token), /Identity provider account status unavailable/) }
  finally { providerUnavailable = false }
})

test('disabled local bindings cannot own, mint or retain an app session', async () => {
  const id = identity('disabled-binding')
  await store.bind(id, a, 'legacy-session')
  const session = await store.createSession(id)
  await admin.query('UPDATE public.app_identity_bindings SET disabled_at=now() WHERE project_id=$1 AND subject=$2', [id.projectId, id.subject])
  assert.equal(await store.owner(id), null)
  assert.equal(await store.session(session.token), null)
  await assert.rejects(store.createSession(id), /Account unavailable/)
  await assert.rejects(store.bind(id, a, 'operator-recovery'), /Identity binding unavailable/)
})

test('session provenance cannot be reassigned to a different application account', async () => {
  const id = identity('provenance')
  await store.bind(id, a, 'legacy-session')
  await store.createSession(id)
  // The second app account is disabled above, but ownership constraints remain
  // independent of that mutable state.
  await assert.rejects(admin.query('UPDATE public.app_sessions SET user_id=$1 WHERE project_id=$2 AND subject=$3', [b, id.projectId, id.subject]), { code: '23503' })
})

test('old sessions with no provider provenance require a fresh sign-in', async () => {
  const id = identity('unattributed')
  await store.bind(id, a, 'legacy-session')
  const session = await store.createSession(id)
  await admin.query('UPDATE public.app_sessions SET project_id=NULL,subject=NULL WHERE project_id=$1 AND subject=$2', [id.projectId, id.subject])
  assert.equal(await store.session(session.token), null)
})

test('binding and session creation reject stale or future authentication', async () => {
  for (const authenticatedAt of [Math.floor(Date.now() / 1000) - 301, Math.floor(Date.now() / 1000) + 60]) {
    const id = { ...identity('stale'), authenticatedAt }
    await assert.rejects(store.bind(id, a, 'legacy-session'), /Recent authentication required/)
    await assert.rejects(store.createSession(id), /Recent authentication required/)
  }
})

test('browser challenges are stored as hashes and consumed only once under concurrency', async () => {
  const challenge = await store.issueChallenge()
  const rows = await admin.query('SELECT token_hash FROM public.app_identity_challenges')
  assert.ok(rows.rows.every(row => /^[a-f0-9]{64}$/.test(row.token_hash) && row.token_hash !== challenge))
  const outcomes = await Promise.all([store.consumeChallenge(challenge), store.consumeChallenge(challenge)])
  assert.equal(outcomes.filter(Boolean).length, 1)
  assert.equal(await store.consumeChallenge(challenge), false)
})

test('expired browser challenges cannot authenticate or link accounts', async () => {
  const challenge = await store.issueChallenge()
  await admin.query("UPDATE public.app_identity_challenges SET created_at=now()-interval '3 minutes',expires_at=now()-interval '1 minute'")
  assert.equal(await store.consumeChallenge(challenge), false)
  assert.equal(await store.consumeChallenge('invalid'), false)
})

test('phone provenance promotion preserves the locked immutable app UID and requires current coherent provider proof', async () => {
  const uid = randomUUID(), base = { ...identity('phone-promotion'),provider: 'google.com' as const }
  await admin.query('INSERT INTO public.app_accounts(id) VALUES($1)',[uid])
  await store.bind(base,uid,'legacy-session')
  const verified = { ...base,provider: 'phone' as const,phone: '+15559876543' }
  const promoting = new IdentityStore(backend,async () => ({ disabled: false,validSince: 0 }),async () => ({ disabled: false,validSince: 0,phoneE164: verified.phone }))
  await promoting.bind(verified,uid,'owned-session')
  const row = (await admin.query('SELECT user_id,provider,binding_proof FROM public.app_identity_bindings WHERE subject=$1',[base.subject])).rows[0]
  assert.deepEqual(row,{ user_id: uid,provider: 'phone',binding_proof: 'legacy-session' })
})

test('mismatched or revoked phone promotion rolls back without changing the existing binding', async () => {
  const uid = randomUUID(), base = { ...identity('phone-promotion-denied'),provider: 'google.com' as const }
  await admin.query('INSERT INTO public.app_accounts(id) VALUES($1)',[uid]); await store.bind(base,uid,'legacy-session')
  const promoting = new IdentityStore(backend,async () => ({ disabled: false,validSince: 0 }),async () => ({ disabled: false,validSince: 0,phoneE164: '+15550000000' }))
  await assert.rejects(promoting.bind({ ...base,provider: 'phone' },uid,'owned-session'))
  assert.equal((await admin.query('SELECT provider FROM public.app_identity_bindings WHERE subject=$1',[base.subject])).rows[0].provider,'google.com')
  await admin.query('UPDATE public.app_identity_bindings SET disabled_at=now() WHERE subject=$1',[base.subject])
  await assert.rejects(promoting.bind({ ...base,provider: 'phone' },uid,'owned-session'),/binding unavailable/)
})
