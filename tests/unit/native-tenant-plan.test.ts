import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { readNativeTenantPlan, reconcileNativeSettings } from '@/lib/data/tenant-plan'
import { resolveEffectivePlan } from '@/lib/tenant-plan-model'
import { settingsPatchForPlan } from '@/lib/plan-settings'
const state = vi.hoisted(() => ({ source: vi.fn(), plan: vi.fn(), capabilities: vi.fn(), reconcile: vi.fn(), explicit: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/data/tenant-plan-runtime', () => ({ readOwnedTenantPlan: state.plan, readOwnedTenantCapabilities: state.capabilities, reconcileOwnedTenantPlan: state.reconcile, reconcileOwnedSettings: state.explicit }))
import { getTenantPlan, getTenantCapabilities, reconcileTenantSettings, reconcileSettingsWithPlan } from '@/lib/tenant-plan'
const tenantId = randomUUID(), planId = randomUUID()
const row = () => ({ id: planId, name: 'Plan', slug: 'orders', description: null, monthly_price: '25.50', annual_price: '250.00', transaction_fee_pct: '3.50', features: ['orders'], billing_cycle: 'monthly', status: 'active', override_monthly_price: '0.00', override_annual_price: null, override_transaction_fee_pct: '0.00', override_notes: 'grandfathered account' })
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
it('native numeric DTO preserves zero overrides and grandfathering without changing the shared resolver', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [row()] }), result = await readNativeTenantPlan(query, tenantId)
  expect(result).toEqual({ id: planId, name: 'Plan', slug: 'orders', description: null, monthly_price: 0, annual_price: 250, transaction_fee_pct: 0, features: ['orders'], billing_cycle: 'monthly', status: 'active', is_grandfathered: true })
  expect(query.mock.calls[0][1]).toEqual([tenantId])
})
it('non-live subscriptions retain plan facts while revoking all paid features', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ ...row(), status: 'past_due' }] })
  expect(await readNativeTenantPlan(query, tenantId)).toMatchObject({ monthly_price: 0, status: 'past_due', features: [] })
  expect(resolveEffectivePlan(null, { billing_cycle: 'monthly', status: 'active', override_monthly_price: null, override_annual_price: null, override_transaction_fee_pct: null, override_notes: null })).toBeNull()
})
it('unknown/malformed tenants return no plan and ambiguous/corrupt native facts refuse', async () => {
  const query = vi.fn(); expect(await readNativeTenantPlan(query, 'invalid')).toBeNull(); expect(query).not.toHaveBeenCalled()
  query.mockResolvedValueOnce({ rows: [] }); expect(await readNativeTenantPlan(query, tenantId)).toBeNull()
  for (const rows of [[row(), row()], [{ ...row(), monthly_price: null }], [{ ...row(), features: ['orders', 123] }]]) {
    query.mockResolvedValueOnce({ rows }); await expect(readNativeTenantPlan(query, tenantId)).rejects.toMatchObject({ status: 503 })
  }
})
it('reconciliation uses only the canonical downgrade switches and never changes fees, harmless modes or other tenants', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] }), patch = settingsPatchForPlan([])
  expect(await reconcileNativeSettings(query, tenantId, [])).toEqual({ ok: true, patch })
  expect(query.mock.calls[0]).toEqual(['SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE', [tenantId]])
  const [sql, values] = query.mock.calls[1]; expect(values).toEqual([tenantId]); expect(sql).not.toMatch(/delivery_fee_cents|pickup_eta_minutes|dine_in_enabled|pickup_enabled|DELETE/)
  for (const key of Object.keys(patch)) expect(sql).toContain(`${key}=false`)
})
it('native shared readers ignore an explicit legacy client and never instantiate the Source factory', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.plan.mockResolvedValue(null); state.capabilities.mockResolvedValue({ guestOrdering: false })
  const legacy = { from: vi.fn() }
  expect(await getTenantPlan(tenantId, legacy as never)).toBeNull(); expect(await getTenantCapabilities(tenantId, null, legacy as never)).toEqual({ guestOrdering: false })
  expect(legacy.from).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled(); expect(state.capabilities).toHaveBeenCalledWith(tenantId, null)
})
it('native failures are terminal and reconciliation reports failure without Source mutation fallback', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.plan.mockRejectedValue(new Error('Unavailable')); state.reconcile.mockRejectedValue(new Error('Unavailable')); state.explicit.mockRejectedValue(new Error('Unavailable'))
  await expect(getTenantPlan(tenantId)).rejects.toThrow('Unavailable')
  expect(await reconcileTenantSettings(tenantId)).toEqual({ ok: false, patch: {}, error: 'Subscription information is unavailable' })
  expect(await reconcileSettingsWithPlan(tenantId, [])).toMatchObject({ ok: false, error: 'Service settings are unavailable' }); expect(state.source).not.toHaveBeenCalled()
})
it('the flag-off source reader keeps the same result through the shared pure override model', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', '')
  const plan = { id: planId, name: 'Plan', slug: 'orders', description: null, monthly_price: 25.5, annual_price: 250, transaction_fee_pct: 3.5, features: ['orders'] }
  const subscription = { tenant_id: tenantId, billing_cycle: 'monthly', status: 'active', override_monthly_price: 0, override_annual_price: null, override_transaction_fee_pct: 0, override_notes: 'grandfathered', plans: plan }
  const chain = { select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue({ data: subscription, error: null }) }; chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain)
  state.source.mockReturnValue({ from: () => chain })
  expect(await getTenantPlan(tenantId)).toMatchObject({ monthly_price: 0, transaction_fee_pct: 0, annual_price: 250, is_grandfathered: true, features: ['orders'] }); expect(state.plan).not.toHaveBeenCalled()
})
