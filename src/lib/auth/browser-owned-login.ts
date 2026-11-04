import { requireLoginAuthority } from './browser-login-authority'

async function post(request: typeof fetch, path: string, body: object) {
  const response = await request(path,{ method: 'POST',credentials: 'same-origin',cache: 'no-store',redirect: 'error',
    headers: { 'Content-Type': 'application/json' },body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result?.message === 'string' ? result.message : 'Your access could not be confirmed. Try again or contact support for reviewed recovery.')
  return result
}
export async function ownedLoginDestination(next = '/', request: typeof fetch = fetch): Promise<string> {
  await requireLoginAuthority('owned',request)
  const result = await post(request,'/api/auth/resolve-redirect',{ next })
  if (typeof result.redirectTo !== 'string' || !result.redirectTo.startsWith('/') || result.redirectTo.startsWith('//')
    || result.redirectTo.includes('\\') || /[\u0000-\u001f\u007f]/.test(result.redirectTo)) throw new Error('Your destination could not be confirmed.')
  return result.redirectTo
}
/** Native path only: an owned denial never initializes or falls back to legacy Auth. */
export async function completeOwnedLogin(idToken: string, options: {
  next?: string; link?: boolean; existing?: { email: string; password: string }
} = {}, request: typeof fetch = fetch) {
  await requireLoginAuthority('owned',request)
  const challenge = async () => {
    const result = await post(request,'/api/identity/challenge',{})
    if (typeof result.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.challenge)) throw new Error('Browser verification could not be confirmed.')
    return result.challenge as string
  }
  if (options.existing) {
    const result = await post(request,'/api/identity/existing-account-link',{ idToken,challenge: await challenge(),...options.existing })
    if (result?.linked !== true) throw new Error('Account linking could not be confirmed.')
  } else if (options.link) {
    const result = await post(request,'/api/identity/link',{ idToken,challenge: await challenge() })
    if (result?.linked !== true) throw new Error('Account linking could not be confirmed.')
  }
  const result = await post(request,'/api/identity/login',{ idToken,challenge: await challenge() })
  if (result?.authenticated !== true) throw new Error('Sign-in could not be confirmed.')
  return ownedLoginDestination(options.next,request)
}
