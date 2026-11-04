import { randomBytes, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentProviderPhone, createGoogleCustomerAccountReader } from '@/lib/auth/google-customer-account'
import { readOwnedCustomer } from '@/lib/auth/owned-customer'
import { IdentityStore, type BindingProof } from '@/lib/auth/identity-store'
import type { OwnedPrincipal } from '@/lib/auth/owned-principal'

const phone = '+15551234567', changed = '+15557654321', subject = 'fixture-subject', token = randomBytes(32).toString('base64url')
const now = new Date(Math.floor(Date.now()/1000)*1000), uid = randomUUID()
const actor: OwnedPrincipal = { userId: uid,authenticatedAt: now,role: 'customer',tenantId: null,tenant: null,fullName: null,mustChangePassword: false }
const session = { user_id: uid,authenticated_at: now,project_id: 'skaleclub',subject,provider: 'phone' }
const account = { localId: subject,phoneNumber: phone,providerUserInfo: [{ providerId: 'phone',rawId: phone,phoneNumber: phone }],validSince: '0' }
afterEach(() => vi.useRealTimers())

describe('current phone evidence and owned UUID', () => {
  it('uses only a single coherent current phone credential, never contacts or Google email', () => {
    expect(currentProviderPhone(account)).toBe(phone)
    for (const value of [
      { phoneNumber: phone,providerUserInfo: [{ providerId: 'google.com',email: phone }] },
      { ...account,phoneNumber: changed },{ ...account,providerUserInfo: [...account.providerUserInfo,...account.providerUserInfo] },
      { ...account,providerUserInfo: [{ providerId: 'phone',rawId: phone,phoneNumber: changed }] },
      { ...account,phoneNumber: undefined,phone },
    ]) expect(currentProviderPhone(value)).toBeNull()
  })

  it('keeps a Google-only UUID without granting phone access or requesting metadata', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ...session,provider: 'google.com' }] }), metadata = vi.fn()
    expect(await readOwnedCustomer(actor,token,query,metadata)).toMatchObject({ userId: uid,phoneE164: null })
    expect(metadata).not.toHaveBeenCalled()
    expect(query.mock.calls[0][1][1]).toBe(uid); expect(query.mock.calls[0][1][0]).not.toBe(token)
  })

  it('reads the current number on each request and never inherits the previous number', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [session] })
    const metadata = vi.fn().mockResolvedValueOnce({ disabled: false,validSince: 0,phoneE164: phone }).mockResolvedValueOnce({ disabled: false,validSince: 0,phoneE164: changed })
    expect((await readOwnedCustomer(actor,token,query,metadata))?.phoneE164).toBe(phone)
    expect((await readOwnedCustomer(actor,token,query,metadata))?.phoneE164).toBe(changed)
    expect(metadata).toHaveBeenCalledTimes(2)
    expect(metadata).toHaveBeenCalledWith({ projectId: 'skaleclub',subject })
  })

  it('rejects absent/revoked/mismatched session bindings without metadata or legacy fallback', async () => {
    const metadata = vi.fn()
    for (const rows of [[],[{ ...session,user_id: randomUUID() }],[session,session]]) {
      expect(await readOwnedCustomer(actor,token,vi.fn().mockResolvedValue({ rows }),metadata)).toBeNull()
    }
    expect(await readOwnedCustomer({ ...actor,mustChangePassword: true },token,vi.fn(),metadata)).toBeNull()
    expect(metadata).not.toHaveBeenCalled()
  })

  it('denies disabled/revoked/unavailable Google status instead of granting a stale phone', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [session] })
    for (const status of [{ disabled: true,validSince: 0,phoneE164: phone },{ disabled: false,validSince: now.getTime()/1000+1,phoneE164: phone }]) {
      await expect(readOwnedCustomer(actor,token,query,vi.fn().mockResolvedValue(status))).rejects.toThrow('disabled or revoked')
    }
    await expect(readOwnedCustomer(actor,token,query,vi.fn().mockRejectedValue(new Error('unavailable')))).rejects.toThrow('unavailable')
  })
})

describe('Google customer metadata lookup', () => {
  it('uses a single exact subject, existing read scope and a restricted response field mask', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ users: [account] }))
    const reader = createGoogleCustomerAccountReader(async () => 'fixture-access',request)
    expect(await reader({ projectId: 'skaleclub',subject })).toEqual({ disabled: false,validSince: 0,phoneE164: phone })
    expect(request).toHaveBeenCalledWith('https://identitytoolkit.googleapis.com/v1/projects/skaleclub/accounts:lookup',expect.objectContaining({
      method: 'POST',cache: 'no-store',redirect: 'error',body: JSON.stringify({ localId: [subject] }),
      headers: expect.objectContaining({ 'X-Goog-FieldMask': expect.not.stringContaining('password') }),
    }))
  })

  it('rejects multi-account, wrong subject, tenant-scoped and malformed responses', async () => {
    for (const users of [[account,account],[{ ...account,localId: 'foreign' }],[{ ...account,tenantId: 'foreign' }],[{ ...account,validSince: 'invalid' }]]) {
      const reader = createGoogleCustomerAccountReader(async () => 'fixture-access',vi.fn().mockResolvedValue(Response.json({ users })))
      await expect(reader({ projectId: 'skaleclub',subject })).rejects.toThrow('metadata unavailable')
    }
  })

  it('bounds ignored cancellation and oversized bodies', async () => {
    vi.useFakeTimers()
    const reader = createGoogleCustomerAccountReader(async () => 'fixture-access',vi.fn(() => new Promise<Response>(() => {})),10)
    const pending = reader({ projectId: 'skaleclub',subject }).catch(error => error)
    await vi.advanceTimersByTimeAsync(11); expect(await pending).toBeInstanceOf(Error)
    const large = createGoogleCustomerAccountReader(async () => 'fixture-access',vi.fn().mockResolvedValue(new Response('x'.repeat(65537))))
    await expect(large({ projectId: 'skaleclub',subject })).rejects.toThrow('metadata unavailable')
  })
})

describe('phone provenance promotion', () => {
  function fixture(options: { phone?: string; disabled?: boolean; boundUser?: string; revoked?: boolean } = {}) {
    const sequence: string[] = []
    const query = vi.fn(async (sql: string) => {
      sequence.push(sql)
      if (sql.includes('FROM public.app_accounts WHERE')) return { rows: [{ id: uid }],rowCount: 1 }
      if (sql.includes('SELECT user_id,disabled_at,provider')) return { rows: [{ user_id: options.boundUser ?? uid,provider: 'google.com',disabled_at: options.revoked ? now : null }],rowCount: 1 }
      return { rows: [],rowCount: 1 }
    })
    const metadata = vi.fn(async () => { sequence.push('METADATA'); return { disabled: options.disabled ?? false,validSince: 0,phoneE164: options.phone ?? phone } })
    const client = { query,release: vi.fn() },store = new IdentityStore({ connect: async () => client } as unknown as Pool,async () => ({ disabled: false,validSince: 0 }),metadata)
    const identity = { projectId: 'skaleclub',subject,provider: 'phone' as const,phone,authenticatedAt: now.getTime()/1000 }
    return { sequence,query,metadata,store,identity }
  }

  it('promotes only the same locked binding after independent possession and coherent current phone proof', async () => {
    const f = fixture(); await f.store.bind(f.identity,uid,'owned-session')
    expect(f.sequence.indexOf('METADATA')).toBeGreaterThan(f.sequence.findIndex(sql => sql.includes('SELECT user_id,disabled_at,provider')))
    expect(f.sequence.at(-1)).toBe('COMMIT')
    const update = f.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE public.app_identity_bindings'))
    expect(update).toBeDefined(); expect(f.sequence.some(sql => /UPDATE public\.(profiles|app_accounts)/.test(sql))).toBe(false)
  })

  it('rolls back a changed phone, disabled provider, revoked binding, foreign UID or unreviewed proof kind', async () => {
    for (const [options,proof] of [[{ phone: changed },'owned-session'],[{ disabled: true },'owned-session'],[{ revoked: true },'owned-session'],[{ boundUser: randomUUID() },'owned-session'],[{},'google-subject']] as Array<[Parameters<typeof fixture>[0],BindingProof]>) {
      const f = fixture(options); await expect(f.store.bind(f.identity,uid,proof)).rejects.toThrow()
      expect(f.sequence.at(-1)).toBe('ROLLBACK'); expect(f.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE public.app_identity_bindings'))).toBe(false)
    }
  })
})
