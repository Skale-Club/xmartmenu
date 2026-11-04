import { randomBytes } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { requireLoginAuthority } from '@/lib/auth/browser-login-authority'
import { completeOwnedLogin, ownedLoginDestination } from '@/lib/auth/browser-owned-login'
const challenge = randomBytes(32).toString('base64url')
afterEach(() => vi.unstubAllEnvs())

it('accepts only an explicit current authority and fails closed on deny/unknown/transport error', async () => {
  for (const response of [Response.json({ authority: 'owned' }),Response.json({ authority: 'unavailable' },{ status: 503 }),Response.json({}),new Response('invalid')]) {
    await expect(requireLoginAuthority('legacy',vi.fn().mockResolvedValue(response))).rejects.toThrow()
  }
  await expect(requireLoginAuthority('legacy',vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow()
  const request = vi.fn().mockResolvedValue(Response.json({ authority: 'legacy' }))
  await requireLoginAuthority('legacy',request)
  expect(request).toHaveBeenCalledWith('/api/auth/authority',expect.objectContaining({ cache: 'no-store',redirect: 'error',credentials: 'same-origin' }))
})

it('links by explicit previous-password proof, then uses a new challenge/login and a server destination', async () => {
  const calls: Array<{ path: string; body: Record<string,unknown> }> = []
  const request = vi.fn(async (path: string | URL | Request,options?: RequestInit) => {
    calls.push({ path: String(path),body: options?.body ? JSON.parse(String(options.body)) : {} })
    expect(options).toMatchObject({ cache: 'no-store',redirect: 'error',credentials: 'same-origin' })
    return Response.json(String(path).endsWith('authority') ? { authority: 'owned' } : String(path).endsWith('challenge') ? { challenge } : String(path).endsWith('resolve-redirect') ? { redirectTo: '/dashboard' } : { linked: true })
  })
  expect(await completeOwnedLogin('fixture-google-proof',{ existing: { email: 'old@example.test',password: 'fixture-password' },next: '/' },request)).toBe('/dashboard')
  expect(calls.map(call => call.path)).toEqual(['/api/auth/authority','/api/identity/challenge','/api/identity/existing-account-link','/api/identity/challenge','/api/identity/login','/api/auth/authority','/api/auth/resolve-redirect'])
  expect(calls[2].body).toEqual({ idToken: 'fixture-google-proof',challenge,email: 'old@example.test',password: 'fixture-password' })
  expect(calls[4].body).toEqual({ idToken: 'fixture-google-proof',challenge })
})

it('does not try login, redirect or a legacy request after a denied link', async () => {
  const request = vi.fn(async (path: string | URL | Request) => Response.json(String(path).endsWith('authority') ? { authority: 'owned' } : String(path).endsWith('challenge') ? { challenge } : { message: 'Ownership conflict' },{ status: String(path).endsWith('existing-account-link') ? 409 : 200 }))
  await expect(completeOwnedLogin('fixture-proof',{ existing: { email: 'old@example.test',password: 'fixture-password' } },request)).rejects.toThrow('Ownership conflict')
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/auth/authority','/api/identity/challenge','/api/identity/existing-account-link'])
})

it('rejects external and ambiguous server destinations without a dashboard fallback', async () => {
  for (const redirectTo of ['https://outside.test','//outside.test','/\\outside.test','/unsafe\npath']) {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ authority: 'owned' })).mockResolvedValueOnce(Response.json({ redirectTo }))
    await expect(ownedLoginDestination('/',request)).rejects.toThrow('destination')
  }
})

it('authority endpoint is explicit/no-store and refuses owned mode with disabled provider', async () => {
  const { GET } = await import('@/app/api/auth/authority/route')
  vi.stubEnv('OWNED_AUTH_ENABLED','false'); expect(await (await GET()).json()).toEqual({ authority: 'legacy' })
  vi.stubEnv('OWNED_AUTH_ENABLED','true'); vi.stubEnv('GOOGLE_AUTH_ENABLED','false')
  expect((await GET()).status).toBe(503)
  vi.stubEnv('GOOGLE_AUTH_ENABLED','true'); const result = await GET()
  expect(await result.json()).toEqual({ authority: 'owned' }); expect(result.headers.get('cache-control')).toContain('no-store')
})
