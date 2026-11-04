import { describe, expect, it } from 'vitest'
import { resolveIdentity } from '@/lib/auth/identity-policy'
import type { VerifiedGoogleIdentity } from '@/lib/auth/google-identity'

const identity: VerifiedGoogleIdentity = { projectId: 'skaleclub', subject: 'firebase-subject', provider: 'google.com', googleSubject: 'google-subject', authenticatedAt: 1, email: 'owner@example.com' }

describe('preserving existing account ownership', () => {
  it('does not claim an account by verified email or phone alone', () => {
    expect(resolveIdentity({ identity })).toEqual({ kind: 'recovery-required' })
    expect(resolveIdentity({ identity: { ...identity, provider: 'phone', phone: '+15551234567' } })).toEqual({ kind: 'recovery-required' })
  })
  it('keeps the immutable application ID for a linked identity', () => {
    expect(resolveIdentity({ identity, linkedUserId: 'old-uuid' })).toEqual({ kind: 'existing', userId: 'old-uuid' })
  })
  it('requires legacy ownership proof or exact Google provider subject', () => {
    expect(resolveIdentity({ identity, authenticatedLegacyUserId: 'old-uuid' })).toEqual({ kind: 'bind', userId: 'old-uuid' })
    expect(resolveIdentity({ identity, legacyGoogleUserId: 'old-uuid' })).toEqual({ kind: 'bind', userId: 'old-uuid' })
    expect(resolveIdentity({ identity: { ...identity, googleSubject: undefined }, legacyGoogleUserId: 'old-uuid' })).toEqual({ kind: 'recovery-required' })
  })
  it('refuses conflicting ownership and disabled accounts', () => {
    expect(resolveIdentity({ identity, linkedUserId: 'a', authenticatedLegacyUserId: 'b' }).kind).toBe('conflict')
    expect(resolveIdentity({ identity, legacyGoogleUserId: 'a', authenticatedLegacyUserId: 'b' }).kind).toBe('conflict')
    expect(resolveIdentity({ identity, linkedUserId: 'a', accountDisabled: true }).kind).toBe('recovery-required')
  })
})
