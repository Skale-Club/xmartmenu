import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { NativeRegistration, RegistrationConflict } from '@/lib/auth/native-registration'
import { createIdentityHttp, type IdentityHttpDependencies } from '@/lib/auth/identity-http'
import { nativeOnboarding } from '@/lib/auth/native-onboarding'

const fresh = () => ({ projectId: 'test-project',subject: 'new-subject',provider: 'phone' as const,phone: '+15551234567',authenticatedAt: Math.floor(Date.now()/1000) })
describe('native registration boundary', () => {
  it('rejects stale, future, wrong-project, unsupported and revoked factors before SQL', async () => {
    const connect = vi.fn(), account = vi.fn(async () => ({ disabled: false,validSince: 0,phoneE164: '+15551234567' }))
    const registration = new NativeRegistration({ connect } as unknown as Pool,'test-project',account)
    for (const identity of [ { ...fresh(),projectId: 'other-project' },{ ...fresh(),authenticatedAt: Math.floor(Date.now()/1000)-301 },
      { ...fresh(),authenticatedAt: Math.floor(Date.now()/1000)+30 },{ ...fresh(),provider: 'password' as 'phone' } ]) await expect(registration.create(identity,'Name','customer')).rejects.toThrow()
    account.mockResolvedValueOnce({ disabled: true,validSince: 0,phoneE164: '+15551234567' })
    await expect(registration.create(fresh(),'Name','customer')).rejects.toThrow()
    account.mockResolvedValueOnce({ disabled: false,validSince: 0,phoneE164: '+15557654321' })
    await expect(registration.create(fresh(),'Name','customer')).rejects.toThrow()
    expect(connect).not.toHaveBeenCalled()
  })
  it('HTTP requires browser challenge and rejects role, UUID, tenant, preview, demo and signed-in injection', async () => {
    const challenge = randomBytes(32).toString('base64url'), register = vi.fn(async () => ({ token: randomBytes(32).toString('base64url'),expiresAt: new Date(Date.now()+60000) }))
    const deps: IdentityHttpDependencies = { enabled: () => true,origin: 'https://identity.test',config: { projectId: 'test-project',apiKey: 'test',authDomain: 'test' },
      verifyConfig: async () => {},allowRequest: async () => true,verify: async () => fresh(),legacyOwner: async () => null,register,
      store: { issueChallenge: async () => challenge,consumeChallenge: async value => value === challenge,owner: async () => null,bind: async () => {},
        createSession: async () => { throw new Error('Must use atomic registration') },session: async () => null,logout: async () => {},revokeAll: async () => {} } }
    const handle = createIdentityHttp(deps)
    const call = (body: object, extra = '',origin = 'https://identity.test') => handle(new Request('https://identity.test/api/identity/register-business',{
      method: 'POST',headers: { host: 'identity.test',origin,'content-type': 'application/json',cookie: `__Host-xm_identity_challenge=${challenge}${extra}` },body: JSON.stringify({ idToken: 'proof',name: 'Name',challenge,...body }) }), 'register-business')
    for (const body of [{ role: 'superadmin' },{ userId: 'injected' },{ tenant_id: 'injected' },{ challenge: 'wrong' }]) expect((await call(body)).status).toBeGreaterThanOrEqual(400)
    for (const extra of ['; xm_demo=1','; preview_tenant_id=tenant','; __Host-xm_identity=bad']) expect((await call({},extra)).status).toBe(403)
    expect((await call({},'','https://evil.test')).status).toBe(403)
    expect(register).not.toHaveBeenCalled()
    const response = await call({})
    expect(response.status).toBe(201); expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ subject: 'new-subject' }),'Name','business')
    register.mockRejectedValueOnce(new RegistrationConflict())
    expect((await call({})).status).toBe(409)
  })
  it('onboarding denies disabled, recovery, absent and superadmin accounts before canonical function', async () => {
    for (const row of [null,{ role: 'superadmin' },{ role: 'customer',disabled_at: new Date() },{ role: 'store-admin',must_change_password: true }]) {
      const query = vi.fn(async () => ({ rows: row ? [row] : [] }))
      await expect(nativeOnboarding(query,'11111111-1111-4111-8111-111111111111','a'.repeat(64),{})).rejects.toThrow()
      expect(query).toHaveBeenCalledTimes(2)
    }
  })
})
