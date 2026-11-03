import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { assertProviderAccountActive, createGoogleAccountStatusReader } from '@/lib/auth/provider-account-status'

const identity = { projectId: 'skaleclub', subject: 'firebase-user' }

describe('live Identity Platform account status', () => {
  it('uses the fixed project lookup endpoint with only the exact immutable UID', async () => {
    const token = randomUUID()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ users: [{ localId: identity.subject, validSince: '123' }] })))
    const lookup = createGoogleAccountStatusReader(async () => token, request)
    expect(await lookup(identity)).toEqual({ disabled: false, validSince: 123 })
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('https://identitytoolkit.googleapis.com/v1/projects/skaleclub/accounts:lookup')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${token}` } })
    expect(JSON.parse(String(init?.body))).toEqual({ localId: [identity.subject] })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('does not cache current disabled or revocation state', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: [{ localId: identity.subject }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: [{ localId: identity.subject, disabled: true, validSince: '456' }] })))
    const lookup = createGoogleAccountStatusReader(async () => randomUUID(), request)
    expect(await lookup(identity)).toEqual({ disabled: false, validSince: 0 })
    expect(await lookup(identity)).toEqual({ disabled: true, validSince: 456 })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each([
    {}, { users: [] }, { users: [{ localId: 'another-user' }] },
    { users: [{ localId: identity.subject }, { localId: identity.subject }] },
    { users: [{ localId: identity.subject, disabled: 'false' }] },
    ...['', '-1', '1.2', '1e3', '9007199254740992'].map(validSince => ({ users: [{ localId: identity.subject, validSince }] })),
  ])('denies missing, ambiguous or malformed provider records %j', async body => {
    const lookup = createGoogleAccountStatusReader(async () => randomUUID(), async () => new Response(JSON.stringify(body)))
    await expect(lookup(identity)).rejects.toThrow('Identity provider account status unavailable')
  })

  it('sanitizes credential, transport and provider failures', async () => {
    const sensitive = randomUUID()
    const credentialsFail = createGoogleAccountStatusReader(async () => { throw new Error(sensitive) })
    const networkFail = createGoogleAccountStatusReader(async () => sensitive, async () => { throw new Error(sensitive) })
    const providerFail = createGoogleAccountStatusReader(async () => sensitive, async () => new Response(sensitive, { status: 403 }))
    for (const lookup of [credentialsFail, networkFail, providerFail]) {
      await expect(lookup(identity)).rejects.toEqual(new Error('Identity provider account status unavailable'))
    }
  })

  it('rejects a substituted project before asking for credentials', async () => {
    const credentials = vi.fn(async () => randomUUID())
    const lookup = createGoogleAccountStatusReader(credentials)
    await expect(lookup({ ...identity, projectId: 'skaleclub/other-project' })).rejects.toThrow('Invalid provider identity')
    expect(credentials).not.toHaveBeenCalled()
  })
})

describe('provider revocation compared with original authentication time', () => {
  it('allows unchanged status and rejects disabled or revoked identities', () => {
    expect(() => assertProviderAccountActive({ disabled: false, validSince: 123 }, 123)).not.toThrow()
    expect(() => assertProviderAccountActive({ disabled: true, validSince: 0 }, 123)).toThrow()
    expect(() => assertProviderAccountActive({ disabled: false, validSince: 124 }, 123)).toThrow()
  })
  it.each([-1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revocation timestamp %s', validSince => {
    expect(() => assertProviderAccountActive({ disabled: false, validSince }, 123)).toThrow()
  })
})
