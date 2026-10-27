import { describe, expect, it } from 'vitest'
import { canManageTenant, isTenantMemberRole, normalizeRole } from '@/lib/auth/role-utils'

describe('normalizeRole', () => {
  it('maps legacy names and rejects unknown roles', () => {
    expect(normalizeRole('admin')).toBe('store-admin')
    expect(normalizeRole('super-admin')).toBe('superadmin')
    expect(normalizeRole('owner')).toBeNull()
    expect(normalizeRole(undefined)).toBeNull()
  })
})

describe('isTenantMemberRole', () => {
  it('admits only back-office roles of a restaurant', () => {
    expect(isTenantMemberRole('store-admin')).toBe(true)
    expect(isTenantMemberRole('store-staff')).toBe(true)
    expect(isTenantMemberRole('customer')).toBe(false)
    expect(isTenantMemberRole('superadmin')).toBe(false)
    expect(isTenantMemberRole(null)).toBe(false)
  })
})

describe('canManageTenant', () => {
  it('is an allowlist: staff, customers and unknown roles cannot manage', () => {
    expect(canManageTenant('store-admin')).toBe(true)
    expect(canManageTenant('superadmin')).toBe(true)
    expect(canManageTenant('store-staff')).toBe(false)
    expect(canManageTenant('customer')).toBe(false)
    expect(canManageTenant(normalizeRole('owner'))).toBe(false)
  })
})
