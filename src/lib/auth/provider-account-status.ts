import type { VerifiedGoogleIdentity } from './google-identity'
import { createGoogleAccountLookup } from './google-account-lookup'

export type ProviderIdentity = Pick<VerifiedGoogleIdentity, 'projectId' | 'subject'>
export type ProviderAccountStatus = { disabled: boolean; validSince: number }
export type ProviderAccountStatusReader = (identity: ProviderIdentity) => Promise<ProviderAccountStatus>

/** Signature verification alone cannot establish current provider revocation. */
export function assertProviderAccountActive(status: ProviderAccountStatus, authenticatedAt: number): void {
  if (typeof status.disabled !== 'boolean' || status.disabled || !Number.isSafeInteger(status.validSince)
    || status.validSince < 0 || !Number.isSafeInteger(authenticatedAt) || authenticatedAt <= 0
    || status.validSince > authenticatedAt) throw new Error('Identity is disabled or revoked')
}

/**
 * The credential provider must supply a short-lived Google OAuth access token
 * (ADC/workload federation), scoped to identitytoolkit. Only users.get is needed.
 * Neither provider payloads nor credential-bearing SDK errors escape this seam.
 */
export function createGoogleAccountStatusReader(
  accessToken: (signal: AbortSignal) => Promise<string>,
  request: typeof fetch = fetch,
): ProviderAccountStatusReader {
  return createGoogleAccountLookup((_identity, signal) => accessToken(signal), request)
}
