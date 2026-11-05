import { describe, expect, it } from 'vitest'
import { waiterAccess } from '@/lib/auth/waiter-access'

describe('waiterAccess (native session, no Supabase)', () => {
  it('lets store staff and admins of this tenant and any superadmin in', () => {
    expect(waiterAccess({ role: 'store-staff', tenantId: 't1' }, 't1')).toBe(true)
    expect(waiterAccess({ role: 'store-admin', tenantId: 't1' }, 't1')).toBe(true)
    expect(waiterAccess({ role: 'superadmin', tenantId: null }, 't1')).toBe(true)
  })
  it('keeps out customers, other tenants and nobody', () => {
    expect(waiterAccess({ role: 'customer', tenantId: 't1' }, 't1')).toBe(false)
    expect(waiterAccess({ role: 'store-staff', tenantId: 't2' }, 't1')).toBe(false)
    expect(waiterAccess({ role: 'store-staff', tenantId: null }, 't1')).toBe(false)
    expect(waiterAccess(null, 't1')).toBe(false)
  })
})
