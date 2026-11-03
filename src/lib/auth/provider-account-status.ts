import type { VerifiedGoogleIdentity } from './google-identity'

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
  accessToken: () => Promise<string>,
  request: typeof fetch = fetch,
): ProviderAccountStatusReader {
  return async identity => {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(identity.projectId)
      || !identity.subject || identity.subject.length > 128) throw new Error('Invalid provider identity')
    try {
      const token = await accessToken()
      if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error()
      const response = await request(`https://identitytoolkit.googleapis.com/v1/projects/${identity.projectId}/accounts:lookup`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: [identity.subject] }), signal: AbortSignal.timeout(8_000),
        cache: 'no-store', redirect: 'error',
      })
      if (!response.ok) throw new Error()
      const body = await response.json() as { users?: Array<{ localId?: string; disabled?: unknown; validSince?: unknown }> }
      const matches = Array.isArray(body.users) ? body.users.filter(user => user.localId === identity.subject) : []
      if (matches.length !== 1) throw new Error()
      const account = matches[0]
      if (account.disabled !== undefined && typeof account.disabled !== 'boolean') throw new Error()
      if (account.validSince !== undefined && (typeof account.validSince !== 'string' || !/^\d+$/.test(account.validSince))) throw new Error()
      const validSince = account.validSince === undefined ? 0 : Number(account.validSince)
      if (!Number.isSafeInteger(validSince) || validSince < 0) throw new Error()
      return { disabled: account.disabled === true, validSince }
    } catch {
      throw new Error('Identity provider account status unavailable')
    }
  }
}
