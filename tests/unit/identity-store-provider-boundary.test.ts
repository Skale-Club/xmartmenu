import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { IdentityStore } from '@/lib/auth/identity-store'
import type { VerifiedGoogleIdentity } from '@/lib/auth/google-identity'

const identity: VerifiedGoogleIdentity = {
  projectId: 'skaleclub', subject: 'verified-phone-user', provider: 'phone', phone: '+15551234567',
  authenticatedAt: Math.floor(Date.now() / 1000),
}

describe('provider preconditions before database effects', () => {
  it('denies revoked or disabled identities before binding or creating sessions', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('Database must not be touched'))
    for (const status of [{ disabled: true, validSince: 0 }, { disabled: false, validSince: identity.authenticatedAt + 1 }]) {
      const store = new IdentityStore({ connect } as unknown as Pool, async () => status)
      await expect(store.bind(identity, 'existing-app-user', 'legacy-session')).rejects.toThrow('Identity is disabled or revoked')
      await expect(store.createSession(identity)).rejects.toThrow('Identity is disabled or revoked')
    }
    expect(connect).not.toHaveBeenCalled()
  })

  it('denies stale and future authentication before provider or database calls', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('Database must not be touched'))
    const status = vi.fn(async () => ({ disabled: false, validSince: 0 }))
    const store = new IdentityStore({ connect } as unknown as Pool, status)
    for (const authenticatedAt of [identity.authenticatedAt - 301, identity.authenticatedAt + 60]) {
      await expect(store.bind({ ...identity, authenticatedAt }, 'existing-app-user', 'legacy-session')).rejects.toThrow('Recent authentication required')
      await expect(store.createSession({ ...identity, authenticatedAt })).rejects.toThrow('Recent authentication required')
    }
    expect(connect).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
  })

  it('sanitizes provider credential failures without starting a transaction', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('Database must not be touched'))
    const store = new IdentityStore({ connect } as unknown as Pool, async () => { throw new Error('Authorization header must not escape') })
    await expect(store.createSession(identity)).rejects.toEqual(new Error('Identity provider account status unavailable'))
    expect(connect).not.toHaveBeenCalled()
  })
})
