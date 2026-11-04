import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { signOwnedStripeState, verifyOwnedStripeState } from '@/lib/stripe-owned-state'
import { signOAuthState, verifyOAuthState } from '@/lib/stripe-oauth-state'
const actor = randomUUID(), tenant = randomUUID(), now = Date.now()
beforeEach(() => { vi.stubEnv('OAUTH_STATE_SECRET', randomBytes(32).toString('hex')) })
afterEach(() => vi.unstubAllEnvs())
it('binds the verified actor and tenant and rejects tampering/expired/future claims', () => {
  const state = signOwnedStripeState(actor, tenant, now)
  expect(verifyOwnedStripeState(state, now)).toMatchObject({ actorId: actor, tenantId: tenant, expiresAt: now + 15 * 60 * 1000 })
  expect(verifyOwnedStripeState(state, now)?.nonceHash).toMatch(/^[a-f0-9]{64}$/)
  expect(signOwnedStripeState(actor, tenant, now)).not.toBe(state)
  expect(verifyOwnedStripeState(`${state}x`, now)).toBeNull()
  expect(verifyOwnedStripeState(state, now + 15 * 60 * 1000 + 1)).toBeNull()
  expect(verifyOwnedStripeState(signOwnedStripeState(actor, tenant, now + 30001), now)).toBeNull()
})
it('uses a separate domain so legacy tenant-only state cannot authorize native callback or vice versa', () => {
  expect(verifyOwnedStripeState(signOAuthState(tenant), now)).toBeNull()
  expect(verifyOAuthState(signOwnedStripeState(actor, tenant, now))).toBeNull()
})
it('rejects malformed/oversized state and invalid IDs without producing a signed identity', () => {
  for (const value of ['', '.', 'a.b.c', ' '.repeat(40), 'a'.repeat(2049)]) expect(verifyOwnedStripeState(value, now)).toBeNull()
  expect(() => signOwnedStripeState('not-a-uid', tenant, now)).toThrow()
  expect(() => signOwnedStripeState(actor, 'not-a-tenant', now)).toThrow()
})
