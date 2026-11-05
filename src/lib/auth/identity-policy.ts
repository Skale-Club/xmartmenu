import type { VerifiedGoogleIdentity } from './google-identity'

export type AccountRef = { userId: string; disabled: boolean }
export type LoginResolution =
  | { kind: 'existing'; userId: string }
  | { kind: 'bind'; userId: string; proof: 'google-subject' | 'phone-match' }
  | { kind: 'blocked' }
  | { kind: 'phone-required' }
  | { kind: 'phone-ambiguous' }
  | { kind: 'unknown-phone' }

/**
 * Xpot rule. Ownership comes only from (1) an existing binding, (2) an imported
 * Google subject matched by exact value, or (3) a verified phone equal to ONE
 * account's phone. E-mail is never an input: it cannot claim an account.
 */
export function resolveLogin(input: {
  identity: Pick<VerifiedGoogleIdentity, 'provider' | 'googleSubject' | 'phone'>
  linkedUserId?: string | null
  googleClaim?: AccountRef | null
  phoneOwners?: AccountRef[]
}): LoginResolution {
  const { identity } = input
  if (input.linkedUserId) return { kind: 'existing', userId: input.linkedUserId }
  if (identity.provider === 'google.com') {
    const claim = identity.googleSubject ? input.googleClaim : null
    if (!claim) return { kind: 'phone-required' }
    return claim.disabled ? { kind: 'blocked' } : { kind: 'bind', userId: claim.userId, proof: 'google-subject' }
  }
  const owners = identity.phone ? input.phoneOwners ?? [] : []
  if (owners.length === 0) return { kind: 'unknown-phone' }
  if (owners.length > 1) return { kind: 'phone-ambiguous' }
  return owners[0].disabled ? { kind: 'blocked' } : { kind: 'bind', userId: owners[0].userId, proof: 'phone-match' }
}
