import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { brtDayStart, OwnedShellRepository, shellPlan } from '@/lib/auth/owned-shell'
import type { OwnedPrincipal } from '@/lib/auth/owned-principal'
import type { Plan } from '@/types/database'

const tenant = randomUUID(), other = randomUUID()
const actor: OwnedPrincipal = { userId: randomUUID(), authenticatedAt: new Date(), role: 'store-admin', tenantId: tenant,
  fullName: null, mustChangePassword: false, tenant: null }

describe('owned shell authorization and compatibility', () => {
  it('rejects customer, foreign tenant and recovery before any SQL', async () => {
    const query = vi.fn(), repo = new OwnedShellRepository(query)
    for (const principal of [{ ...actor, role: 'customer' as const }, { ...actor, mustChangePassword: true }, actor]) {
      await expect(repo.dashboard(principal, principal === actor ? other : tenant)).rejects.toThrow('Forbidden')
    }
    await expect(repo.overview(actor)).rejects.toThrow('Forbidden')
    await expect(repo.tenants(actor)).rejects.toThrow('Forbidden')
    expect(query).not.toHaveBeenCalled()
  })

  it('scopes dashboard counts to exact tenant and the historical BRT boundary', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ products: 2, categories: 3, scans: 4 }] })
    expect(await new OwnedShellRepository(query).dashboard(actor, tenant, new Date('2026-11-04T02:59:59Z'))).toEqual({ products: 2, categories: 3, scans: 4 })
    expect(query.mock.calls[0][1]).toEqual([tenant, '2026-11-03T03:00:00.000Z'])
    expect(brtDayStart(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-04T03:00:00.000Z')
  })

  it('preserves zero overrides, inactive subscription features and grandfathered state', () => {
    const plan = { id: randomUUID(), name: 'Base', slug: 'base', description: null, monthly_price: 20, annual_price: 200, transaction_fee_pct: 2, features: ['orders'] } as Plan
    const subscription = { billing_cycle: 'monthly' as const, status: 'active' as const, override_monthly_price: 0,
      override_annual_price: null, override_transaction_fee_pct: 0, override_notes: 'grandfathered fixture' }
    const result = shellPlan(subscription, plan)
    expect(result).toMatchObject({ monthly_price: 0, annual_price: 200, transaction_fee_pct: 0, features: ['orders'], is_grandfathered: true })
    expect(shellPlan({ ...subscription, status: 'cancelled' }, plan)?.features).toEqual([])
    expect(shellPlan(null, plan)).toBeNull()
  })

  it('rejects ambiguous singleton records rather than selecting a privileged default', async () => {
    const repo = new OwnedShellRepository(vi.fn().mockResolvedValue({ rows: [{}, {}] }))
    await expect(repo.platform()).rejects.toThrow('singleton')
  })

  it('uses SQL account counts and parameterized periods without requesting provider records', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const result = await new OwnedShellRepository(query).overview({ ...actor, role: 'superadmin' }, new Date('2026-11-04T12:00:00Z'))
    expect(result.activity).toEqual([])
    expect(query.mock.calls.some(([sql]) => sql === 'SELECT id FROM public.app_accounts')).toBe(true)
    expect(query.mock.calls.at(-1)?.[1]).toEqual(['2026-10-05T12:00:00.000Z', '2026-11-04T12:00:00.000Z'])
  })
})
