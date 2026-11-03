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
const store = new IdentityStore(backend)
const a = randomUUID(), b = randomUUID()
const identity = (subject: string): VerifiedGoogleIdentity => ({ projectId: 'skaleclub', subject, provider: 'phone', phone: '+15551234567', authenticatedAt: Math.floor(Date.now() / 1000) })

before(async () => {
  await admin.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;')
  await admin.query(await readFile(new URL('../../supabase/migrations/20261103190000_application_identity.sql', import.meta.url), 'utf8'))
  await admin.query('INSERT INTO public.app_accounts(id) VALUES($1),($2)', [a, b])
})
after(async () => { await backend.end(); await admin.end() })

test('migration does not expose identities or sessions through browser roles', async () => {
  const c = await admin.connect()
  try {
    await c.query('SET ROLE authenticated')
    await assert.rejects(c.query('SELECT * FROM public.app_identity_bindings'), { code: '42501' })
    await assert.rejects(c.query('UPDATE public.app_accounts SET session_version=1'), { code: '42501' })
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
