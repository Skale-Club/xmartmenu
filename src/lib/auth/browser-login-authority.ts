export type LoginAuthority = 'owned' | 'legacy'
/** Denial, invalid JSON, redirects and transport failures never select legacy. */
export async function readLoginAuthority(request: typeof fetch = fetch): Promise<LoginAuthority> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(),5000)
  try {
    const response = await request('/api/auth/authority',{ credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal })
    if (!response.ok || response.redirected) throw new Error('Sign-in is temporarily unavailable. Reload and try again.')
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('authority' in value) || typeof value.authority !== 'string' || !['owned','legacy'].includes(value.authority)) throw new Error('Sign-in mode changed. Reload this page before continuing.')
    return value.authority as LoginAuthority
  } finally { clearTimeout(timeout); controller.abort() }
}
export async function requireLoginAuthority(expected: LoginAuthority, request: typeof fetch = fetch) {
  if (await readLoginAuthority(request) !== expected) throw new Error('Sign-in mode changed. Reload this page before continuing.')
}
