import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ownedAuthSelected, ownedSessionToken, OwnedPrincipalRepository, readOwnedPrincipal, type OwnedPrincipal } from '@/lib/auth/owned-principal'

const user = randomUUID(), tenant = randomUUID(), other = randomUUID()
const token = randomBytes(32).toString('base64url')
const authenticatedAt = new Date(Date.now()-60_000)
const row = () => ({ id: user, role: 'store-admin', tenant_id: tenant, full_name: 'Fixture', must_change_password: false,
  account_disabled_at: null, tenant: { id: tenant, name: 'Fixture', slug: 'fixture', is_active: true, plan: 'menu' } })
const principal = (role: OwnedPrincipal['role'] = 'store-admin'): OwnedPrincipal => ({ userId: user, authenticatedAt, role,
  tenantId: tenant, fullName: 'Fixture', mustChangePassword: false, tenant: row().tenant })

describe('native principal boundary', () => {
  it('defaults off and refuses ambiguous mode configuration', () => {
    expect(ownedAuthSelected({})).toBe(false); expect(ownedAuthSelected({ OWNED_AUTH_ENABLED: 'false' })).toBe(false)
    expect(ownedAuthSelected({ OWNED_AUTH_ENABLED: 'true' })).toBe(true)
    for (const value of ['TRUE', 'yes', '']) expect(() => ownedAuthSelected({ OWNED_AUTH_ENABLED: value })).toThrow()
  })

  it('accepts only one exact native cookie and never a legacy/plain/encoded alternative', () => {
    expect(ownedSessionToken(`__Host-xm_identity=${token}`, true)).toBe(token)
    expect(ownedSessionToken(`xm_identity=${token}`, false)).toBe(token)
    for (const cookie of [null, `xm_identity=${token}`, `sb-access-token=${token}`,
      `__Host-xm_identity=${token};__Host-xm_identity=${token}`, '__Host-xm_identity=%41'.repeat(43), '__Host-xm_identity=short']) {
      expect(ownedSessionToken(cookie, true)).toBeNull()
    }
  })

  it('uses the verified immutable session UID as the sole profile query parameter on every read', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()] }), session = vi.fn().mockResolvedValue({ userId: user, authenticatedAt })
    const repository = new OwnedPrincipalRepository(query)
    expect((await readOwnedPrincipal(token, { session }, repository))?.userId).toBe(user)
    await readOwnedPrincipal(token, { session }, repository)
    expect(session).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][1]).toEqual([user])
    expect(query.mock.calls[0][0]).toContain('a.disabled_at IS NULL')
    expect(query.mock.calls[0][0]).not.toMatch(/email|phone|INSERT|UPDATE/i)
  })

  it('never reads a profile for missing/invalid/unavailable verified sessions', async () => {
    const query = vi.fn(), session = vi.fn().mockResolvedValue(null), repository = new OwnedPrincipalRepository(query)
    expect(await readOwnedPrincipal(null, { session }, repository)).toBeNull()
    expect(await readOwnedPrincipal('bad', { session }, repository)).toBeNull()
    expect(session).not.toHaveBeenCalled()
    expect(await readOwnedPrincipal(token, { session }, repository)).toBeNull()
    session.mockRejectedValue(new Error('Provider revoked or unavailable'))
    await expect(readOwnedPrincipal(token, { session }, repository)).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })

  it('denies disabled, missing, duplicate, wrong-UID, unknown-role and inconsistent-tenant profiles', async () => {
    for (const rows of [[], [row(), row()], [{ ...row(), id: other }], [{ ...row(), role: 'owner-by-email' }],
      [{ ...row(), account_disabled_at: new Date() }], [{ ...row(), tenant: { ...row().tenant, id: other } }]]) {
      const repository = new OwnedPrincipalRepository(vi.fn().mockResolvedValue({ rows }))
      expect(await repository.profile(user, authenticatedAt)).toBeNull()
    }
  })

  it('rejects invalid UID or future authentication before SQL', async () => {
    const query = vi.fn(), repository = new OwnedPrincipalRepository(query)
    expect(await repository.profile("';SELECT 1;--", authenticatedAt)).toBeNull()
    expect(await repository.profile(user, new Date('invalid'))).toBeNull()
    expect(await repository.profile(user, new Date(Date.now()+60_000))).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('permits preview lookup only for an active superadmin and binds the exact UUID', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ...row().tenant, id: other }] }), repository = new OwnedPrincipalRepository(query)
    for (const actor of [principal('customer'), principal('store-staff'), principal(), { ...principal('superadmin'), mustChangePassword: true }]) {
      expect(await repository.previewTenant(actor, other)).toBeNull()
    }
    expect(await repository.previewTenant(principal('superadmin'), 'invalid')).toBeNull()
    expect(query).not.toHaveBeenCalled()
    expect((await repository.previewTenant(principal('superadmin'), other))?.id).toBe(other)
    expect(query.mock.calls[0][1]).toEqual([other])
  })
})
