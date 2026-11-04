import { describe, expect, it, vi } from 'vitest'
import { OwnedOrderRepository, ordersDataOwned, type OrderQuery } from '@/lib/data/orders'

const tenantId = 'e7b7f160-0000-4000-8000-000000000001'
const context = { tenantId, role: 'store-staff' as const }
const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

function fixtureQuery(overrides: { active?: boolean; features?: string[]; settings?: boolean } = {}) {
  const order = { id: 'order-1', tenant_id: tenantId, status: 'pending', created_at: cutoff, total: 12.5,
    order_items: [{ id: 'item-1', order_id: 'order-1', product_name: 'Soup', quantity: 1, unit_price: 12.5 }] }
  const query = vi.fn<OrderQuery>(async (text, values) => {
    if (text.includes('FROM public.tenants t LEFT JOIN public.tenant_settings')) return { rows: [{ row: {
      id: tenantId, is_active: overrides.active ?? true, tenant_settings: overrides.settings === false ? null : {
        amber_threshold_minutes: 7, red_threshold_minutes: 16, currency: 'BRL', orders_enabled: true,
        table_management_enabled: true, direct_orders_enabled: false,
      },
    } }] }
    if (text.includes('FROM public.tenant_subscriptions')) return { rows: overrides.features === null ? [] : [{ features: overrides.features ?? ['orders'] }] }
    if (text.includes('FROM public.orders o')) return { rows: [{ row: order }] }
    if (text.includes('FROM public.locations l')) return { rows: [{ row: { id: 'location-1', name: 'Downtown', slug: 'downtown' } }] }
    throw new Error(`Unexpected query: ${text}`)
  })
  return { query, order }
}

describe('owned KDS SSR bootstrap', () => {
  it('uses the owned flag and returns scoped orders/items, SQL capabilities, settings and active locations', async () => {
    expect(ordersDataOwned({ OWNED_ORDER_DATA_ENABLED: 'true' })).toBe(true)
    expect(ordersDataOwned({ OWNED_ORDER_DATA_ENABLED: 'false' })).toBe(false)
    const { query } = fixtureQuery()
    const result = await new OwnedOrderRepository(query, tenantId).kdsBootstrap(context, cutoff)
    expect(result.capabilities.kds).toBe(true)
    expect(result.capabilities.tables).toBe(true)
    expect(result.orders[0].order_items[0].product_name).toBe('Soup')
    expect(result.locations).toEqual([{ id: 'location-1', name: 'Downtown', slug: 'downtown' }])
    expect(result.amberThreshold).toBe(7)
    expect(result.redThreshold).toBe(16)
    expect(result.currency).toBe('BRL')
    const orderRead = query.mock.calls.find(([text]) => text.includes('FROM public.orders o'))!
    expect(orderRead[0]).toContain('o.tenant_id=$1 AND o.created_at >= $2::timestamptz')
    expect(orderRead[1]).toEqual([tenantId, cutoff])
    expect(query.mock.calls.some(([text]) => text.includes('order_items oi') && text.includes('jsonb_agg'))).toBe(true)
    expect(query.mock.calls.find(([text]) => text.includes('FROM public.locations l'))![0]).toContain('l.tenant_id=$1 AND l.is_active=true ORDER BY l.created_at ASC')
  })

  it('uses safe defaults and never loads orders for an inactive tenant', async () => {
    const { query } = fixtureQuery({ active: false })
    await expect(new OwnedOrderRepository(query, tenantId).kdsBootstrap(context, cutoff)).rejects.toMatchObject({ status: 404 })
    expect(query.mock.calls.some(([text]) => text.includes('FROM public.orders o'))).toBe(false)
  })

  it('fails the KDS capability closed when the tenant has no live orders feature', async () => {
    const { query } = fixtureQuery({ features: [], settings: false })
    const result = await new OwnedOrderRepository(query, tenantId).kdsBootstrap(context, cutoff)
    expect(result.capabilities.kds).toBe(false)
    expect(result.amberThreshold).toBe(10)
    expect(result.redThreshold).toBe(20)
    expect(result.currency).toBe('USD')
  })
})
