import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createIdentityHttp, type IdentityHttpDependencies } from '@/lib/auth/identity-http'
import type { VerifiedGoogleIdentity } from '@/lib/auth/google-identity'

const opaque = () => randomBytes(32).toString('base64url')
const origin = 'https://identity.example.test'
type Ref = { userId: string; disabled: boolean }

function fixture() {
  const now = () => Math.floor(Date.now() / 1000)
  const state = {
    identity: {} as VerifiedGoogleIdentity,
    bindings: new Map<string, string>(),
    claims: new Map<string, Ref>(), phones: new Map<string, Ref[]>(),
    proofs: [] as string[],
    pendings: new Map<string, { projectId: string; subject: string; authenticatedAt: number; expires: number }>(),
  }
  const challenges = new Set<string>(), sessions = new Map<string, string>(), cookies = new Map<string, string>()
  const google = (extra: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity => ({ projectId: 'skaleclub', subject: 'fb-google', provider: 'google.com', googleSubject: 'g-sub-1', email: 'same@example.test', authenticatedAt: now(), ...extra })
  const phone = (extra: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity => ({ projectId: 'skaleclub', subject: 'fb-phone', provider: 'phone', phone: '+15551234567', authenticatedAt: now(), ...extra })
  const deps: IdentityHttpDependencies = {
    enabled: () => true, origin, config: { apiKey: 'k', projectId: 'skaleclub', authDomain: 'skaleclub.firebaseapp.com' },
    verifyConfig: async () => {}, allowRequest: async () => true,
    verify: async token => { if (token !== 'proof') throw new Error('x'); return state.identity },
    legacyOwner: async () => null,
    store: {
      issueChallenge: async () => { const v = opaque(); challenges.add(v); return v },
      consumeChallenge: async t => challenges.delete(t),
      owner: async id => state.bindings.get(id.subject) ?? null,
      bind: async (id, userId, proof) => { state.bindings.set(id.subject, userId); state.proofs.push(proof) },
      createSession: async id => { const t = opaque(); sessions.set(t, state.bindings.get(id.subject)!); return { token: t, expiresAt: new Date(Date.now() + 3_600_000) } },
      session: async t => sessions.has(t) ? { userId: sessions.get(t)!, authenticatedAt: new Date() } : null,
      logout: async t => { sessions.delete(t) }, revokeAll: async () => {},
      googleClaim: async sub => state.claims.get(sub) ?? null,
      phoneOwners: async p => state.phones.get(p) ?? [],
      issuePending: async id => { const t = opaque(); state.pendings.set(t, { projectId: id.projectId, subject: id.subject, authenticatedAt: id.authenticatedAt, expires: Date.now() + 600_000 }); return t },
      takePending: async t => { const p = state.pendings.get(t); state.pendings.delete(t); return p && p.expires > Date.now() ? p : null },
      bindPendingGoogle: async (p, userId) => { state.bindings.set(p.subject, userId); return true },
    },
  }
  const handle = createIdentityHttp(deps)
  const send = async (op: string, body?: object) => {
    const response = await handle(new Request(`${origin}/api/identity/${op}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } }), op)
    for (const m of (response.headers.get('set-cookie') ?? '').matchAll(/(?:^|, )([^=;,\s]+)=([^;]*)/g)) { if (m[2]) cookies.set(m[1], m[2]); else cookies.delete(m[1]) }
    return response
  }
  const login = async (id: VerifiedGoogleIdentity) => {
    state.identity = id
    const { challenge } = await (await send('challenge', {})).json()
    return send('login', { challenge, idToken: 'proof' })
  }
  return { state, sessions, cookies, google, phone, login, send }
}

describe('first sign-in: imported Google subject and verified phone', () => {
  it('signs in a Google token whose subject was imported and binds it as google-subject', async () => {
    const f = fixture(); f.state.claims.set('g-sub-1', { userId: 'acct-1', disabled: false })
    const res = await f.login(f.google())
    expect(res.status).toBe(200); expect(f.state.proofs).toEqual(['google-subject']); expect(f.sessions.size).toBe(1)
    expect([...f.sessions.values()]).toEqual(['acct-1'])
  })
  it('does not let an equal e-mail with a different Google subject in', async () => {
    const f = fixture(); f.state.claims.set('g-sub-1', { userId: 'acct-1', disabled: false })
    const res = await f.login(f.google({ googleSubject: 'g-sub-OTHER', subject: 'fb-other' }))
    expect(res.status).toBe(409); expect((await res.json()).code).toBe('phone_required')
    expect(f.sessions.size).toBe(0); expect(f.state.bindings.size).toBe(0)
  })
  it('keeps a disabled account blocked, for both Google subject and phone', async () => {
    const f = fixture(); f.state.claims.set('g-sub-1', { userId: 'acct-1', disabled: true })
    const g = await f.login(f.google()); expect(g.status).toBe(403); expect((await g.json()).code).toBe('ACCOUNT_BLOCKED')
    f.state.phones.set('+15551234567', [{ userId: 'acct-2', disabled: true }])
    expect((await f.login(f.phone())).status).toBe(403)
    expect(f.sessions.size).toBe(0); expect(f.state.bindings.size).toBe(0)
  })
  it('binds a verified phone that equals exactly one account and refuses a duplicated number', async () => {
    const f = fixture(); f.state.phones.set('+15551234567', [{ userId: 'acct-1', disabled: false }])
    expect((await f.login(f.phone())).status).toBe(200); expect(f.state.proofs).toEqual(['phone-match'])
    const d = fixture(); d.state.phones.set('+15551234567', [{ userId: 'a', disabled: false }, { userId: 'b', disabled: false }])
    const res = await d.login(d.phone()); expect(res.status).toBe(409); expect((await res.json()).code).toBe('PHONE_AMBIGUOUS')
    expect(d.sessions.size).toBe(0)
  })
  it('sends an unknown phone to the existing customer sign-up, never to an account', async () => {
    const f = fixture(); const res = await f.login(f.phone())
    expect(res.status).toBe(409); expect((await res.json()).code).toBe('ACCOUNT_LINK_REQUIRED'); expect(f.state.bindings.size).toBe(0)
  })
  it('holds an unlinked Google as pending and links it when the phone is confirmed', async () => {
    const f = fixture(); f.state.phones.set('+15551234567', [{ userId: 'acct-1', disabled: false }])
    const first = await f.login(f.google()); expect((await first.json()).code).toBe('phone_required')
    expect(f.state.pendings.size).toBe(1); expect(f.cookies.has('__Host-xm_identity_pending')).toBe(true); expect(f.sessions.size).toBe(0)
    expect((await f.login(f.phone())).status).toBe(200)
    expect(f.state.bindings.get('fb-google')).toBe('acct-1'); expect(f.state.bindings.get('fb-phone')).toBe('acct-1')
    expect(f.state.pendings.size).toBe(0)
    f.cookies.clear()
    expect((await f.login(f.google())).status).toBe(200)
  })
  it('ignores an expired pending Google: the phone still signs in, Google stays unlinked', async () => {
    const f = fixture(); f.state.phones.set('+15551234567', [{ userId: 'acct-1', disabled: false }])
    await f.login(f.google())
    for (const p of f.state.pendings.values()) p.expires = Date.now() - 1
    expect((await f.login(f.phone())).status).toBe(200)
    expect(f.state.bindings.has('fb-google')).toBe(false)
  })
  it('rejects an unknown challenge before binding', async () => {
    const f = fixture(); f.state.claims.set('g-sub-1', { userId: 'acct-1', disabled: false }); f.state.identity = f.google()
    const res = await f.send('login', { challenge: opaque(), idToken: 'proof' })
    expect(res.status).toBe(403); expect(f.state.bindings.size).toBe(0)
  })
})
