import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { mutateAdminServiceSettings, mutateAdminStoreSettings, readAdminStorePage } from '@/lib/data/admin-store-settings'

const tenantId = randomUUID()
const context = { tenantId, role: 'store-admin' as const }

describe('owned store and service settings SQL', () => {
  it('reads the explicit store projection and resolves inactive plans to no capabilities', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'cancelled', features: ['payments', 'stripe-connect'] }] }
      if (sql.includes('FROM public.tenants')) return { rows: [{ custom_domain: null, custom_domain_verified: false }] }
      if (sql.includes('FROM public.stripe_connections')) return { rows: [{ id: 'stripe-id', tenant_id: tenantId, stripe_account_id: 'acct_public_metadata', scope: 'read_write', connected_at: '2026-01-01T00:00:00.000Z', is_active: true, disconnected_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }] }
      return { rows: [{ currency: 'USD', language: 'en', orders_enabled: true }] }
    })
    const result = await readAdminStorePage(query, context)
    expect(result.settings).toMatchObject({ currency: 'USD', orders_enabled: true })
    expect(result.capabilities.plan.payments).toBe(false)
    expect(result.capabilities.plan.stripe).toBe(false)
    expect(result.stripeConnection).toMatchObject({ stripe_account_id: 'acct_public_metadata', is_active: true })
    expect(query.mock.calls.some(([sql]) => sql.includes('s.status, p.features'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM public.stripe_connections') && sql.includes('WHERE tenant_id=$1 AND is_active=true'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes('SELECT *'))).toBe(false)
  })

  it('saves only regional fields under the tenant scope and checks tip entitlement in the transaction', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'active', features: ['payments'] }] }
      if (sql.includes('FROM public.tenant_settings')) return { rows: [{ currency: 'USD' }] }
      if (sql.includes('INSERT INTO public.tenant_settings')) return { rows: [{ currency: 'CAD', tip_percentage_1: 16 }] }
      return { rows: [] }
    })
    const result = await mutateAdminStoreSettings(query, context, { currency: ' CAD ', tip_percentage_1: 16 })
    expect(result.settings).toMatchObject({ currency: 'CAD', tip_percentage_1: 16 })
    expect(query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock')
    expect(query.mock.calls[1]?.[0]).toContain('FOR SHARE OF s,p')
    expect(query.mock.calls.at(-1)?.[0]).toContain('ON CONFLICT (tenant_id) DO UPDATE')
    await expect(mutateAdminStoreSettings(query, context, { tenant_id: randomUUID(), currency: 'USD' })).rejects.toMatchObject({ status: 400 })
  })

  it('prevents paid tip changes on an inactive plan and lets service flags turn off after cancellation', async () => {
    const inactivePlan = vi.fn(async (sql: string) => {
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'cancelled', features: ['payments'] }] }
      if (sql.includes('FROM public.tenant_settings')) return { rows: [{ orders_enabled: true, direct_orders_enabled: true }] }
      if (sql.includes('INSERT INTO public.tenant_settings')) return { rows: [{ orders_enabled: false, direct_orders_enabled: false }] }
      return { rows: [] }
    })
    await expect(mutateAdminStoreSettings(inactivePlan, context, { tip_percentage_1: 17 })).rejects.toMatchObject({ status: 403 })
    const result = await mutateAdminServiceSettings(inactivePlan, context, { direct_orders_enabled: false })
    expect(result.settings.direct_orders_enabled).toBe(false)
    expect(inactivePlan.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF s,p'))).toBe(true)
  })

  it('uses the plan and current settings to gate service mutations, and keeps domain updates tenant-bound', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('tenant_subscriptions')) return { rows: [{ status: 'cancelled', features: ['payments'] }] }
      if (sql.includes('FROM public.tenant_settings')) return { rows: [{ direct_orders_enabled: false }] }
      if (sql.includes('UPDATE public.tenants')) return { rows: [{ custom_domain: 'shop.example.test', custom_domain_verified: false }] }
      if (sql.includes('INSERT INTO public.tenant_settings')) return { rows: [{ direct_orders_enabled: false }] }
      void values
      return { rows: [] }
    })
    await expect(mutateAdminServiceSettings(query, context, { direct_orders_enabled: true })).rejects.toMatchObject({ status: 403 })
    await expect(mutateAdminServiceSettings(query, context, { direct_orders_enabled: false })).resolves.toMatchObject({ settings: { direct_orders_enabled: false } })
    await expect(mutateAdminStoreSettings(query, context, { tip_percentage_1: 20, unknown: true })).rejects.toBeInstanceOf(AdminMenuError)
    await expect(import('@/lib/data/admin-store-settings').then(({ mutateAdminCustomDomain }) => mutateAdminCustomDomain(query, context, tenantId, ' Shop.Example.Test ')))
      .resolves.toEqual({ custom_domain: 'shop.example.test', custom_domain_verified: false })
    await expect(import('@/lib/data/admin-store-settings').then(({ mutateAdminCustomDomain }) => mutateAdminCustomDomain(query, context, randomUUID(), 'shop.example.test')))
      .rejects.toMatchObject({ status: 403 })
  })
})
