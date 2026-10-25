/**
 * Ids and logins from supabase/seed.sql — keep the two in sync.
 * These only exist in the local / CI database.
 */
export const PASSWORD = 'Test-Pass-1234!'

export const TENANTS = {
  menu: { id: 'b0000000-0000-4000-8000-000000000001', slug: 'test-menu', name: 'Test Menu Only' },
  waiter: { id: 'b0000000-0000-4000-8000-000000000002', slug: 'test-waiter', name: 'Test Waiter Bistro' },
  self: { id: 'b0000000-0000-4000-8000-000000000003', slug: 'test-self', name: 'Test Self Service' },
  /** Only for tests that flip restaurant switches (they run serially). */
  switch: { id: 'b0000000-0000-4000-8000-000000000004', slug: 'test-switch', name: 'Test Switches' },
} as const

export type TenantKey = keyof typeof TENANTS

export const USERS = {
  menuOwner: { email: 'owner@test-menu.local', tenant: 'menu' },
  waiterOwner: { email: 'owner@test-waiter.local', tenant: 'waiter' },
  waiterStaff: { email: 'staff@test-waiter.local', tenant: 'waiter' },
  selfOwner: { email: 'owner@test-self.local', tenant: 'self' },
  selfStaff: { email: 'staff@test-self.local', tenant: 'self' },
  switchStaff: { email: 'staff@test-switch.local', tenant: 'switch' },
} as const

export type UserKey = keyof typeof USERS

export const storageStatePath = (user: UserKey) => `tests/e2e/.auth/${user}.json`

const TENANT_NUMBER: Record<TenantKey, string> = { menu: '01', waiter: '02', self: '03', switch: '04' }

/** Products per restaurant, same five everywhere. */
export function product(tenant: TenantKey, key: 'burger' | 'steak' | 'cola' | 'juice' | 'brownie') {
  const n = { burger: '1', steak: '2', cola: '3', juice: '4', brownie: '5' }[key]
  const price = { burger: 20, steak: 45, cola: 5, juice: 7, brownie: 9 }[key]
  const name = { burger: 'Classic Burger', steak: 'Ribeye Steak', cola: 'Cola', juice: 'Orange Juice', brownie: 'Brownie' }[key]
  return { id: `e0000000-0000-4000-8000-000000000${TENANT_NUMBER[tenant]}${n}`, name, price }
}

/** Steak's required "Size" group. */
export const steakSizeGroup = (tenant: TenantKey) => `f0000000-0000-4000-8000-000000000${TENANT_NUMBER[tenant]}1`
/** Steak "Size" options: Regular (+0) and Large (+10.00). */
export const steakSize = (tenant: TenantKey, size: 'regular' | 'large') =>
  `f1000000-0000-4000-8000-000000000${TENANT_NUMBER[tenant]}${size === 'regular' ? '1' : '2'}`

export const TABLES = {
  waiterMesa1: { id: 'a1000000-0000-4000-8000-000000000021', name: 'Mesa 1', tenant: 'waiter' },
  selfMesa4: { id: 'a1000000-0000-4000-8000-000000000034', name: 'Mesa 4', tenant: 'self' },
  selfMesa5: { id: 'a1000000-0000-4000-8000-000000000035', name: 'Mesa 5', tenant: 'self' },
  selfInactive: { id: 'a1000000-0000-4000-8000-000000000039', name: 'Old Patio', tenant: 'self' },
  switchMesa9: { id: 'a1000000-0000-4000-8000-000000000049', name: 'Mesa 9', tenant: 'switch' },
} as const
