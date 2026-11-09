/**
 * Development-only phone sign-in on localhost (see src/app/api/identity/dev-phone/route.ts), as Xpot does:
 * no SMS, the screen receives and fills in a development code. Production builds never take this path.
 */
export const DEV_PHONE_SIGN_IN = process.env.NODE_ENV === 'development'

async function call(body: object): Promise<Record<string, unknown>> {
  const response = await fetch('/api/identity/dev-phone', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : 'Development sign-in unavailable')
  return result
}

/** Asks for a development code for this E.164 phone; returns the code to fill in. */
export async function devPhoneStart(phone: string): Promise<string> {
  const result = await call({ action: 'start', phone })
  if (typeof result.devCode !== 'string') throw new Error('Development sign-in unavailable')
  return result.devCode
}

/** Confirms the code; on success the session cookie is set. */
export async function devPhoneVerify(phone: string, code: string): Promise<void> {
  await call({ action: 'verify', phone, code })
}
