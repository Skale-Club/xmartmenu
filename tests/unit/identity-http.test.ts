import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createIdentityHttp, type IdentityHttpDependencies } from '@/lib/auth/identity-http'

const opaque = () => randomBytes(32).toString('base64url')
const origin = 'https://identity.example.test'
function fixture() {
  const state = { enabled: true, permitted: true, revoked: false, unavailable: false, configValid: true, legacyOwner: 'original-app-id', passwordOwner: 'original-app-id', eligible: true, passwordCalls: 0, boundOwner: 'original-app-id', linked: '', proof: '', revokedUser: '', authTime: Math.floor(Date.now() / 1000), projectId: 'skaleclub' }
  const challenges = new Map<string, number>()
  const sessions = new Map<string, { userId: string; authenticatedAt: Date }>()
  const cookies = new Map<string, string>()
  const deps: IdentityHttpDependencies = {
    enabled: () => state.enabled, origin,
    config: { apiKey: 'public-test-config', projectId: 'skaleclub', authDomain: 'skaleclub.firebaseapp.com' },
    verifyConfig: async () => { if (!state.configValid) throw new Error('Sensitive key error must not escape') },
    allowRequest: async () => state.permitted,
    verify: async token => {
      if (token !== 'signed-proof') throw new Error('Untrusted token')
      return { projectId: state.projectId, subject: 'new-provider-subject', provider: 'phone', phone: '+15551234567', authenticatedAt: state.authTime }
    },
    legacyOwner: async token => token === 'legacy-proof' ? state.legacyOwner : null,
    legacyPasswordOwner: async (email,password) => { state.passwordCalls++; return email === 'old@example.test' && password === 'fixture-password' ? state.passwordOwner : null },
    eligibleOwner: async () => state.eligible,
    store: {
      issueChallenge: async () => { const value = opaque(); challenges.set(value, Date.now() + 120_000); return value },
      consumeChallenge: async token => {
        const expires = challenges.get(token)
        if (!expires || expires <= Date.now()) return false
        challenges.delete(token); return true
      },
      owner: async () => state.boundOwner || null,
      bind: async (_, userId, proof) => { state.linked = userId; state.proof = proof },
      createSession: async () => {
        if (state.revoked || state.unavailable) throw new Error('Credential-bearing failure must not escape')
        const token = opaque(); sessions.set(token, { userId: 'original-app-id', authenticatedAt: new Date() })
        return { token, expiresAt: new Date(Date.now() + 8 * 60 * 60_000) }
      },
      session: async token => {
        if (state.unavailable) throw new Error('Credential-bearing failure must not escape')
        return state.revoked ? null : sessions.get(token) ?? null
      },
      logout: async token => { sessions.delete(token) },
      revokeAll: async id => { state.revokedUser = id; sessions.clear() },
    },
  }
  const handle = createIdentityHttp(deps)
  const headers = (extras?: Record<string, string>) => ({ host: new URL(origin).host, origin,
    'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extras })
  const request = async (operation: string, body?: object, extras?: Record<string, string>) => {
    const response = await handle(new Request(`${origin}/api/identity/${operation}`, { method: body ? 'POST' : 'GET', headers: headers(extras), body: body ? JSON.stringify(body) : undefined }), operation)
    for (const match of (response.headers.get('set-cookie') ?? '').matchAll(/(?:^|, )([^=;,\s]+)=([^;]*)/g)) {
      if (match[2]) cookies.set(match[1], match[2]); else cookies.delete(match[1])
    }
    return response
  }
  const challenge = async () => (await (await request('challenge', {})).json()).challenge as string
  const login = async () => request('login', { challenge: await challenge(), idToken: 'signed-proof' })
  return { state, sessions, cookies, challenges, handle, headers, request, challenge, login }
}

describe('owned identity HTTP pilot', () => {
  it('links previous-password proof to the exact existing account without issuing an application session or changing authority', async () => {
    const f = fixture()
    const body = { challenge: await f.challenge(),idToken: 'signed-proof',email: 'old@example.test',password: 'fixture-password' }
    const result = await f.request('existing-account-link',body)
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ linked: true })
    expect(f.state.linked).toBe('original-app-id'); expect(f.state.proof).toBe('legacy-session')
    expect(f.sessions.size).toBe(0); expect(f.cookies.has('__Host-xm_identity')).toBe(false)
    expect((await f.request('existing-account-link',body)).status).toBe(403)
    expect(f.state.passwordCalls).toBe(1)
  })

  it('denies wrong password, unknown/disabled/recovery profile and ownership conflicts without binding', async () => {
    for (const mode of ['wrong-password','ineligible','bound-other','session-other'] as const) {
      const f = fixture()
      if (mode === 'ineligible') f.state.eligible = false
      if (mode === 'bound-other') f.state.boundOwner = 'foreign-app-id'
      if (mode === 'session-other') { await f.login(); f.state.passwordOwner = 'foreign-app-id' }
      const result = await f.request('existing-account-link',{ challenge: await f.challenge(),idToken: 'signed-proof',email: 'old@example.test',password: mode === 'wrong-password' ? 'wrong' : 'fixture-password' })
      expect([403,409]).toContain(result.status); expect(f.state.linked).toBe('')
    }
  })

  it('rejects preview, demo, forged UID and invalid challenge before any password grant', async () => {
    for (const mode of ['preview','demo','caller-uid','challenge','cross-origin','invalid-native'] as const) {
      const f = fixture(), challenge = await f.challenge()
      if (mode === 'preview') f.cookies.set('preview_tenant_id','foreign')
      if (mode === 'demo') f.cookies.set('xm_demo','1')
      if (mode === 'invalid-native') f.cookies.set('__Host-xm_identity',opaque())
      const result = await f.request('existing-account-link',{ challenge: mode === 'challenge' ? opaque() : challenge,idToken: 'signed-proof',email: 'old@example.test',password: 'fixture-password',...(mode === 'caller-uid' ? { userId: 'victim' } : {}) },mode === 'cross-origin' ? { origin: 'https://foreign.test' } : undefined)
      expect(result.status).toBeGreaterThanOrEqual(400); expect(f.state.passwordCalls).toBe(0); expect(f.state.linked).toBe('')
    }
  })

  it('requires recent verified provider authentication and explicit dependencies before previous-password proof', async () => {
    const f = fixture(); f.state.authTime -= 301
    const result = await f.request('existing-account-link',{ challenge: await f.challenge(),idToken: 'signed-proof',email: 'old@example.test',password: 'fixture-password' })
    expect(result.status).toBe(401); expect(f.state.passwordCalls).toBe(0)
  })

  it('is off by default, restricted to the canonical host and never cached', async () => {
    const f = fixture(); f.state.enabled = false
    expect((await f.request('config')).status).toBe(404)
    f.state.enabled = true
    expect((await f.request('config', undefined, { host: 'tenant.example.test' })).status).toBe(404)
    const response = await f.request('config')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).not.toHaveProperty('serviceKey')
  })

  it('does not expose mutable SDK configuration without key-to-project verification', async () => {
    const f = fixture(); f.state.configValid = false
    const response = await f.request('config')
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('public-test-config')
    expect(f.sessions.size).toBe(0)
  })

  it('rejects cross-origin, missing origin, wrong methods and denied limits before effects', async () => {
    const f = fixture()
    expect((await f.request('challenge', {}, { origin: 'https://attacker.example.test' })).status).toBe(403)
    expect((await f.request('challenge', {}, { origin: '' })).status).toBe(403)
    expect((await f.request('challenge')).status).toBe(405)
    f.state.permitted = false
    expect((await f.request('challenge', {})).status).toBe(429)
    expect(f.challenges.size).toBe(0)
  })

  it('requires the exact browser cookie and atomically rejects request replay', async () => {
    const f = fixture(); const challenge = await f.challenge()
    expect((await f.request('login', { challenge, idToken: 'signed-proof' }, { cookie: '' })).status).toBe(403)
    const browserHeaders = f.headers()
    const body = JSON.stringify({ challenge, idToken: 'signed-proof' })
    const results = await Promise.all([1, 2].map(() => f.handle(new Request(`${origin}/api/identity/login`, { method: 'POST', headers: browserHeaders, body }), 'login')))
    expect(results.map(result => result.status).sort()).toEqual([200, 403])
    expect(f.sessions.size).toBe(1)
  })

  it('rotates an opaque host-only HttpOnly cookie without returning credentials or roles', async () => {
    const f = fixture(); const first = await f.login()
    const cookie = first.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('__Host-xm_identity=')
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Domain=')
    expect(await first.json()).toEqual({ authenticated: true })
    const old = f.cookies.get('__Host-xm_identity')!
    expect((await f.login()).status).toBe(200)
    expect(f.sessions.has(old)).toBe(false)
    expect(f.sessions.size).toBe(1)
    expect((await f.request('session')).status).toBe(200)
  })

  it('rejects unknown identities without creating accounts or taking supplied role/owner claims', async () => {
    const f = fixture(); f.state.boundOwner = ''
    expect((await f.login()).status).toBe(409)
    expect(f.sessions.size).toBe(0)
    const challenge = await f.challenge()
    expect((await f.request('link', { challenge, idToken: 'signed-proof', userId: 'victim', role: 'superadmin', email: 'owner@example.test' })).status).toBe(401)
    expect(f.state.linked).toBe('')
    expect(f.state.revokedUser).toBe('')
  })

  it('links only to the independently verified exact legacy UID', async () => {
    const f = fixture(); f.state.boundOwner = ''
    const challenge = await f.challenge()
    const response = await f.request('link', { challenge, idToken: 'signed-proof', userId: 'victim', role: 'superadmin' }, { authorization: 'Bearer legacy-proof' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ linked: true })
    expect(f.state.linked).toBe('original-app-id')
    expect(f.state.proof).toBe('legacy-session')
    expect(f.sessions.size).toBe(0)
    expect((await f.request('link', { challenge, idToken: 'signed-proof' }, { authorization: 'Bearer legacy-proof' })).status).toBe(403)
  })

  it('rejects mismatched owners, invalid legacy proof and preview sessions', async () => {
    const f = fixture(); const challenge = await f.challenge()
    f.state.boundOwner = 'different-owner'
    expect((await f.request('link', { challenge, idToken: 'signed-proof' }, { authorization: 'Bearer legacy-proof' })).status).toBe(409)
    expect((await f.request('link', { challenge, idToken: 'signed-proof' }, { authorization: 'Bearer invalid' })).status).toBe(401)
    f.cookies.set('preview_tenant_id', 'another-tenant')
    expect((await f.request('link', { challenge, idToken: 'signed-proof' }, { authorization: 'Bearer legacy-proof' })).status).toBe(403)
    expect(f.state.linked).toBe('')
  })

  it('rejects duplicate preview or session cookies instead of treating them as absent', async () => {
    const f = fixture(); const challenge = await f.challenge()
    const valid = f.headers().cookie
    expect((await f.request('link', { challenge, idToken: 'signed-proof' }, { authorization: 'Bearer legacy-proof', cookie: `${valid}; preview_tenant_id=first; preview_tenant_id=second` })).status).toBe(403)
    expect((await f.request('link', { challenge, idToken: 'signed-proof' }, { authorization: 'Bearer legacy-proof', cookie: `${valid}; __Host-xm_identity=${opaque()}; __Host-xm_identity=${opaque()}` })).status).toBe(401)
    expect(f.state.linked).toBe('')
  })

  it('accepts recent owned proof and rejects a changed account or stale owned proof', async () => {
    const f = fixture(); await f.login(); const challenge = await f.challenge()
    f.state.legacyOwner = 'another-app-id'
    expect((await f.request('link', { challenge, idToken: 'signed-proof' }, { authorization: 'Bearer legacy-proof' })).status).toBe(409)
    expect((await f.request('link', { challenge, idToken: 'signed-proof' })).status).toBe(200)
    expect(f.state.proof).toBe('owned-session')
    f.sessions.get(f.cookies.get('__Host-xm_identity')!)!.authenticatedAt = new Date(Date.now() - 301_000)
    expect((await f.request('link', { challenge: await f.challenge(), idToken: 'signed-proof' })).status).toBe(401)
  })

  it('denies expired challenges and unverified provider proofs', async () => {
    const f = fixture(); const challenge = await f.challenge()
    f.challenges.set(challenge, Date.now() - 1)
    expect((await f.request('login', { challenge, idToken: 'signed-proof' })).status).toBe(403)
    expect((await f.request('login', { challenge, idToken: 'unsigned' })).status).toBe(401)
    expect(f.sessions.size).toBe(0)
  })

  it('rejects stale, future and substituted-project authentication before session creation', async () => {
    const f = fixture()
    f.state.authTime -= 301
    expect((await f.login()).status).toBe(401)
    f.state.authTime = Math.floor(Date.now() / 1000) + 60
    expect((await f.login()).status).toBe(401)
    f.state.authTime = Math.floor(Date.now() / 1000); f.state.projectId = 'another-project'
    expect((await f.login()).status).toBe(401)
    expect(f.sessions.size).toBe(0)
  })

  it('checks provider revocation and sanitizes outages while allowing local logout', async () => {
    const f = fixture(); await f.login()
    f.state.revoked = true
    expect((await f.request('session')).status).toBe(401)
    f.state.revoked = false; f.state.unavailable = true
    const response = await f.request('session')
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('Credential-bearing')
    expect((await f.request('logout', {})).status).toBe(200)
    expect(f.sessions.size).toBe(0)
  })

  it('revokes only the authenticated account and clears browser cookies', async () => {
    const f = fixture(); await f.login()
    expect((await f.request('revoke-all', { userId: 'victim' })).status).toBe(200)
    expect(f.state.revokedUser).toBe('original-app-id')
    expect(f.cookies.has('__Host-xm_identity')).toBe(false)
  })

  it('rejects non-JSON or oversized bodies without consuming a challenge', async () => {
    const f = fixture(); const challenge = await f.challenge()
    expect((await f.request('login', { challenge, idToken: 'signed-proof' }, { 'content-type': 'text/plain' })).status).toBe(400)
    expect((await f.request('login', { challenge, idToken: 'x'.repeat(20_001) })).status).toBe(400)
    expect(f.challenges.has(challenge)).toBe(true)
  })

  it('cancels a stalled body instead of accepting a partial request or holding a handler indefinitely', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(); let cancelled = false
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{}')) },
        cancel() { cancelled = true },
      })
      const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: f.headers(), body: stream, duplex: 'half' }
      const pending = f.handle(new Request(`${origin}/api/identity/challenge`, init), 'challenge')
      await vi.advanceTimersByTimeAsync(5_001)
      expect((await pending).status).toBe(400)
      expect(cancelled).toBe(true)
      expect(f.challenges.size).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('rejects oversized streams without waiting for a stalled cancellation', async () => {
    const f = fixture()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(20_001)) },
      cancel() { return new Promise(() => {}) },
    })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: f.headers(), body: stream, duplex: 'half' }
    expect((await f.handle(new Request(`${origin}/api/identity/challenge`, init), 'challenge')).status).toBe(400)
    expect(f.challenges.size).toBe(0)
  })
})
