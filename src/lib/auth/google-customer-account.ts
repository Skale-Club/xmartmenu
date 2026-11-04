import { assertProviderAccountActive, type ProviderIdentity, type ProviderAccountStatus } from './provider-account-status'

export type CustomerAccountStatus = ProviderAccountStatus & { phoneE164: string | null }
const E164 = /^\+[1-9]\d{7,14}$/
const unavailable = () => new Error('Identity account metadata unavailable')

/** Select only the current phone credential; profile/contact/MFA fields cannot grant it. */
export function currentProviderPhone(account: Record<string,unknown>): string | null {
  if (typeof account.phoneNumber !== 'string' || !E164.test(account.phoneNumber) || !Array.isArray(account.providerUserInfo)) return null
  const phones = account.providerUserInfo.filter(value => value && typeof value === 'object' && !Array.isArray(value) && value.providerId === 'phone')
  if (phones.length !== 1) return null
  const provider = phones[0] as Record<string,unknown>
  if (provider.rawId !== account.phoneNumber || (provider.phoneNumber !== undefined && provider.phoneNumber !== account.phoneNumber)) return null
  return account.phoneNumber
}

/** Same existing users.get permission/ADC scope; never lists or matches contacts. */
export function createGoogleCustomerAccountReader(accessToken: (signal: AbortSignal) => Promise<string>, request: typeof fetch = fetch, timeoutMs = 8000) {
  return async (identity: ProviderIdentity): Promise<CustomerAccountStatus> => {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(identity.projectId) || typeof identity.subject !== 'string' || !identity.subject || identity.subject.length > 128) throw unavailable()
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_,reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()) }, Number.isFinite(timeoutMs) ? Math.max(1,Math.min(timeoutMs,8000)) : 8000) })
      const lookup = async () => {
        const token = await accessToken(controller.signal); controller.signal.throwIfAborted()
        if (!token || token.length > 16_384 || /[\r\n]/.test(token)) throw unavailable()
        const response = await request(`https://identitytoolkit.googleapis.com/v1/projects/${identity.projectId}/accounts:lookup`,{
          method: 'POST',headers: { Authorization: `Bearer ${token}`,'Content-Type': 'application/json',
            'X-Goog-FieldMask': 'users.localId,users.disabled,users.validSince,users.tenantId,users.phoneNumber,users.providerUserInfo.providerId,users.providerUserInfo.rawId,users.providerUserInfo.phoneNumber' },
          body: JSON.stringify({ localId: [identity.subject] }),signal: controller.signal,cache: 'no-store',redirect: 'error' })
        if (!response.ok || response.redirected || !response.body) { void response.body?.cancel().catch(() => {}); throw unavailable() }
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
        try {
          for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength
            if (size > 65_536) { void reader.cancel().catch(() => {}); throw unavailable() }; chunks.push(part.value) }
        } finally { reader.releaseLock() }
        controller.signal.throwIfAborted()
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!body || typeof body !== 'object' || !('users' in body) || !Array.isArray(body.users) || body.users.length !== 1) throw unavailable()
        const user = body.users[0]
        if (!user || typeof user !== 'object' || Array.isArray(user) || user.localId !== identity.subject || 'tenantId' in user
          || ('disabled' in user && typeof user.disabled !== 'boolean')
          || ('validSince' in user && (typeof user.validSince !== 'string' || !/^\d+$/.test(user.validSince)))) throw unavailable()
        const status = { disabled: user.disabled === true,validSince: Number(user.validSince ?? 0),phoneE164: currentProviderPhone(user) }
        if (!Number.isSafeInteger(status.validSince) || status.validSince < 0) throw unavailable()
        return status
      }
      return await Promise.race([lookup(),deadline])
    } catch { throw unavailable() }
    finally { clearTimeout(timer); controller.abort() }
  }
}

export function requireCurrentPhone(status: CustomerAccountStatus, authenticatedAt: number, phone: string) {
  assertProviderAccountActive(status,authenticatedAt)
  if (!E164.test(phone) || status.phoneE164 !== phone) throw unavailable()
}
