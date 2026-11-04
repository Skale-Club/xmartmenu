import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'), {
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
})

export interface VerifiedGoogleIdentity {
  projectId: string
  subject: string
  provider: 'phone' | 'google.com'
  googleSubject?: string
  phone?: string
  email?: string
  authenticatedAt: number
}

/** Only Firebase/Identity Platform ID tokens; never a Google OAuth access token. */
export async function verifyGoogleIdentity(
  token: string,
  projectId: string,
  options: { keys?: JWTVerifyGetKey; now?: Date; recent?: boolean } = {},
): Promise<VerifiedGoogleIdentity> {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || token.length > 16_384) throw new Error('Invalid identity configuration or token')
  const now = options.now ?? new Date()
  const { payload } = await jwtVerify(token, options.keys ?? googleKeys, {
    algorithms: ['RS256'], audience: projectId, issuer: `https://securetoken.google.com/${projectId}`,
    requiredClaims: ['sub', 'iat', 'exp', 'auth_time'], maxTokenAge: '65m', currentDate: now,
  })
  const seconds = Math.floor(now.getTime() / 1000)
  const firebase = payload.firebase as { sign_in_provider?: unknown; tenant?: unknown; identities?: Record<string, unknown> } | undefined
  const provider = firebase?.sign_in_provider
  if (!payload.sub || payload.sub.length > 128 || firebase?.tenant !== undefined || !['phone', 'google.com'].includes(String(provider))) {
    throw new Error('Unsupported identity provider')
  }
  const authenticatedAt = payload.auth_time
  if (typeof payload.iat !== 'number' || payload.iat > seconds || typeof authenticatedAt !== 'number' ||
    !Number.isSafeInteger(authenticatedAt) || authenticatedAt <= 0 || authenticatedAt > payload.iat ||
    (options.recent && seconds - authenticatedAt > 300)) throw new Error('Recent authentication required')
  const phone = typeof payload.phone_number === 'string' && /^\+[1-9]\d{7,14}$/.test(payload.phone_number) ? payload.phone_number : undefined
  if (provider === 'phone' && !phone) throw new Error('Verified phone required')
  const subjects = firebase?.identities?.['google.com']
  const googleSubject = Array.isArray(subjects) && subjects.length === 1 && typeof subjects[0] === 'string' && subjects[0].length <= 255 ? subjects[0] : undefined
  return {
    projectId, subject: payload.sub, provider: provider as VerifiedGoogleIdentity['provider'], authenticatedAt,
    phone, googleSubject,
    email: payload.email_verified === true && typeof payload.email === 'string' ? payload.email : undefined,
  }
}
