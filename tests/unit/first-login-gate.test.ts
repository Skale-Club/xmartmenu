import { describe, expect, it, vi } from 'vitest'
import { gateFirstLogin } from '@/lib/auth/first-login-gate'

describe('first-login gate', () => {
  const store = () => ({ googleClaim: vi.fn(async () => ({ userId: 'u', disabled: false })), phoneOwners: vi.fn(async () => [{ userId: 'u', disabled: false }]) })
  it('does not look anything up unless native authentication is selected', async () => {
    const s = store(), gated = gateFirstLogin(s, () => false)
    expect(await gated.googleClaim('1')).toBeNull(); expect(await gated.phoneOwners('+15551234567')).toEqual([])
    expect(s.googleClaim).not.toHaveBeenCalled(); expect(s.phoneOwners).not.toHaveBeenCalled()
  })
  it('passes lookups through when selected, evaluated at call time', async () => {
    let selected = false
    const s = store(), gated = gateFirstLogin(s, () => selected)
    expect(await gated.googleClaim('1')).toBeNull()
    selected = true
    expect(await gated.googleClaim('1')).toEqual({ userId: 'u', disabled: false })
    expect(await gated.phoneOwners('+15551234567')).toHaveLength(1)
  })
})
