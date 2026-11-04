import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { legacyPasswordProofConfig, readLegacyPasswordOwner } from '@/lib/auth/legacy-password-proof'
const ref = 'ktogbpqookfcqilqvici'
const env = { NODE_ENV: 'production',NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture' }
const uid = randomUUID(), other = randomUUID()
const token = ['fixture','online','proof'].join('.')
afterEach(() => vi.useRealTimers())

it('uses only the independently online-verified UID, never token response contacts or user fields', async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ access_token: token,refresh_token: 'discarded-fixture',user: { id: other,email: 'form@example.test' } }))
    .mockResolvedValueOnce(Response.json({ id: uid,email: 'different@example.test' }))
  expect(await readLegacyPasswordOwner('form@example.test','fixture-password',{ env,request })).toBe(uid)
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[0][0]).toBe(`https://${ref}.supabase.co/auth/v1/token?grant_type=password`)
  expect(request.mock.calls[1][0]).toBe(`https://${ref}.supabase.co/auth/v1/user`)
  for (const [,options] of request.mock.calls) expect(options).toMatchObject({ cache: 'no-store',redirect: 'error' })
})

it('rejects deleted, banned, invalid UID and invalid ban metadata without a contact fallback', async () => {
  for (const user of [{ id: uid,deleted_at: new Date().toISOString() },{ id: uid,banned_until: '2999-01-01' },{ id: uid,banned_until: 'invalid' },{ id: 'not-uuid',email: 'form@example.test' }]) {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ access_token: token })).mockResolvedValueOnce(Response.json(user))
    expect(await readLegacyPasswordOwner('form@example.test','fixture-password',{ env,request })).toBeNull()
  }
})

it('rejects a failed grant or malformed token before getUser', async () => {
  for (const response of [Response.json({ access_token: token },{ status: 401 }),Response.json({ access_token: 'invalid' })]) {
    const request = vi.fn().mockResolvedValue(response)
    expect(await readLegacyPasswordOwner('form@example.test','fixture-password',{ env,request })).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  }
})

it('bounds ignored cancellation and oversized response streams', async () => {
  vi.useFakeTimers()
  const pending = readLegacyPasswordOwner('form@example.test','fixture-password',{ env,request: vi.fn(() => new Promise<Response>(() => {})),timeoutMs: 10 })
  await vi.advanceTimersByTimeAsync(11); expect(await pending).toBeNull()
  const request = vi.fn().mockResolvedValue(new Response('x'.repeat(65_537)))
  expect(await readLegacyPasswordOwner('form@example.test','fixture-password',{ env,request })).toBeNull()
})

it('never starts an online user lookup after a timed-out grant resolves late', async () => {
  vi.useFakeTimers()
  let resolve: (response: Response) => void = () => {}
  const request = vi.fn(() => new Promise<Response>(done => { resolve = done }))
  const pending = readLegacyPasswordOwner('form@example.test','fixture-password',{ env,request,timeoutMs: 10 })
  await vi.advanceTimersByTimeAsync(11); expect(await pending).toBeNull()
  resolve(Response.json({ access_token: token })); await vi.advanceTimersByTimeAsync(1)
  expect(request).toHaveBeenCalledTimes(1)
})

it('rejects wrong-project/service-role configuration and invalid credentials before transport', async () => {
  const serviceKey = ['fixture',Buffer.from(JSON.stringify({ role: 'service_role',ref })).toString('base64url'),'signature'].join('.')
  for (const overrides of [{ NEXT_PUBLIC_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' },{ NEXT_PUBLIC_SUPABASE_ANON_KEY: serviceKey },{ NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co/other` }]) {
    expect(() => legacyPasswordProofConfig({ ...env,...overrides })).toThrow()
    const request = vi.fn(); expect(await readLegacyPasswordOwner('form@example.test','fixture-password',{ env: { ...env,...overrides },request })).toBeNull()
    expect(request).not.toHaveBeenCalled()
  }
  const request = vi.fn(); expect(await readLegacyPasswordOwner('','',{ env,request })).toBeNull(); expect(request).not.toHaveBeenCalled()
})
