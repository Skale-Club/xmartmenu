import { describe, expect, it } from 'vitest'
import { resolveLogin } from '@/lib/auth/identity-policy'

const google = { provider: 'google.com' as const, googleSubject: 'g-sub' }
const phone = { provider: 'phone' as const, phone: '+15551234567' }
const ok = { userId: 'u1', disabled: false }

describe('resolveLogin', () => {
  it('uses an existing binding first', () => {
    expect(resolveLogin({ identity: google, linkedUserId: 'u9', googleClaim: ok })).toEqual({ kind: 'existing', userId: 'u9' })
  })
  it('binds an imported Google subject, blocks it when the account is disabled', () => {
    expect(resolveLogin({ identity: google, googleClaim: ok })).toEqual({ kind: 'bind', userId: 'u1', proof: 'google-subject' })
    expect(resolveLogin({ identity: google, googleClaim: { ...ok, disabled: true } })).toEqual({ kind: 'blocked' })
  })
  it('asks for a phone when Google has no link, and never uses e-mail', () => {
    expect(resolveLogin({ identity: google })).toEqual({ kind: 'phone-required' })
    expect(resolveLogin({ identity: { ...google, googleSubject: undefined }, googleClaim: ok })).toEqual({ kind: 'phone-required' })
    expect(resolveLogin({ identity: { ...google, email: 'owner@example.test' } as never })).toEqual({ kind: 'phone-required' })
  })
  it('binds a phone equal to one account, refuses duplicates, blocks disabled, unknown goes to customer signup', () => {
    expect(resolveLogin({ identity: phone, phoneOwners: [ok] })).toEqual({ kind: 'bind', userId: 'u1', proof: 'phone-match' })
    expect(resolveLogin({ identity: phone, phoneOwners: [ok, { userId: 'u2', disabled: false }] })).toEqual({ kind: 'phone-ambiguous' })
    expect(resolveLogin({ identity: phone, phoneOwners: [ok, { userId: 'u2', disabled: true }] })).toEqual({ kind: 'phone-ambiguous' })
    expect(resolveLogin({ identity: phone, phoneOwners: [{ ...ok, disabled: true }] })).toEqual({ kind: 'blocked' })
    expect(resolveLogin({ identity: phone, phoneOwners: [] })).toEqual({ kind: 'unknown-phone' })
  })
})
