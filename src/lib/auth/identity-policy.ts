import type { VerifiedGoogleIdentity } from './google-identity'

export type IdentityResolution =
  | { kind: 'existing'; userId: string }
  | { kind: 'bind'; userId: string }
  | { kind: 'recovery-required' }
  | { kind: 'conflict' }

/**
 * Emails/profile phones are hints for operator recovery, never ownership proof.
 * Callers obtain linkedUserId from a unique (project, subject) binding. A
 * legacyGoogleUserId is only an exact, unique old Google provider-sub match to
 * the signed Google identity, not a Supabase/Firebase UUID comparison.
 */
export function resolveIdentity(input: {
  identity: VerifiedGoogleIdentity
  linkedUserId?: string | null
  authenticatedLegacyUserId?: string | null
  legacyGoogleUserId?: string | null
  accountDisabled?: boolean
}): IdentityResolution {
  if (input.accountDisabled) return { kind: 'recovery-required' }
  const { linkedUserId, authenticatedLegacyUserId, legacyGoogleUserId, identity } = input
  if (linkedUserId) {
    if (authenticatedLegacyUserId && authenticatedLegacyUserId !== linkedUserId) return { kind: 'conflict' }
    return { kind: 'existing', userId: linkedUserId }
  }
  const googleOwner = identity.provider === 'google.com' && identity.googleSubject ? legacyGoogleUserId : null
  if (googleOwner && authenticatedLegacyUserId && googleOwner !== authenticatedLegacyUserId) return { kind: 'conflict' }
  const owner = authenticatedLegacyUserId || googleOwner
  return owner ? { kind: 'bind', userId: owner } : { kind: 'recovery-required' }
}
