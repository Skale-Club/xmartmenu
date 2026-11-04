import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose'
import { verifyGoogleIdentity } from '@/lib/auth/google-identity'

const now = new Date('2026-11-03T18:00:00Z')
const seconds = now.getTime() / 1000
let keys: JWTVerifyGetKey
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256' }] })
})
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: 'firebase-id', iss: 'https://securetoken.google.com/skaleclub', aud: 'skaleclub',
    iat: seconds, exp: seconds + 3600, auth_time: seconds, phone_number: '+15551234567',
    firebase: { sign_in_provider: 'phone' }, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey)
}
const verify = async (overrides: Record<string, unknown> = {}, recent = false) => verifyGoogleIdentity(await token(overrides), 'skaleclub', { keys, now, recent })

describe('Google signed identity boundary', () => {
  it('accepts a signed verified phone and ignores app role claims', async () => {
    const result = await verify({ role: 'superadmin' })
    expect(result.phone).toBe('+15551234567')
    expect(result).not.toHaveProperty('role')
  })
  it('exposes verified email and signed Google provider subject only', async () => {
    const google = { sign_in_provider: 'google.com', identities: { 'google.com': ['old-google-sub'] } }
    expect(await verify({ firebase: google, email: 'a@example.com', email_verified: true })).toMatchObject({ googleSubject: 'old-google-sub', email: 'a@example.com' })
    expect((await verify({ firebase: google, email: 'a@example.com' })).email).toBeUndefined()
  })
  it.each([
    { aud: 'another-project' }, { iss: 'https://securetoken.google.com/another-project' },
    { exp: seconds - 1 }, { iat: seconds + 100 }, { auth_time: seconds + 1 },
    { auth_time: 'invalid' }, { sub: '' }, { sub: 'a'.repeat(129) },
    { firebase: { sign_in_provider: 'password' } }, { firebase: { sign_in_provider: 'custom' } },
    { firebase: { sign_in_provider: 'phone', tenant: 'other-tenant' } },
    { phone_number: '5551234567' },
  ])('rejects invalid claims %j', async claims => { await expect(verify(claims)).rejects.toThrow() })
  it('requires a recent real sign-in for a new binding', async () => {
    await expect(verify({ auth_time: seconds - 301 }, true)).rejects.toThrow()
    await expect(verify({ auth_time: seconds - 299 }, true)).resolves.toHaveProperty('subject')
  })
  it('rejects forged signatures and oversized input', async () => {
    const signed = await token()
    const parts = signed.split('.')
    parts[1] = Buffer.from(JSON.stringify({ sub: 'forged' })).toString('base64url')
    await expect(verifyGoogleIdentity(parts.join('.'), 'skaleclub', { keys, now })).rejects.toThrow()
    await expect(verifyGoogleIdentity('a'.repeat(16_385), 'skaleclub', { keys, now })).rejects.toThrow()
  })
})
