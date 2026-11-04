import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderDataError } from '@/lib/data/orders'

const mocks = vi.hoisted(() => ({ effective: vi.fn(), legacy: vi.fn(), cookie: vi.fn(), transaction: vi.fn(),
  capabilities: vi.fn(), stripe: vi.fn(), analytics: vi.fn(), rate: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookie, createServiceClient: mocks.legacy }))
vi.mock('@/lib/tenant-plan', () => ({ getTenantCapabilities: mocks.capabilities }))
vi.mock('@/lib/stripe', () => ({ isStripeEnabled: mocks.stripe }))
vi.mock('@/lib/analytics/server', () => ({ recordTrustedOrderAnalyticsEvent: mocks.analytics }))
vi.mock('@/lib/data/orders-runtime', () => ({ withOwnedOrders: mocks.transaction }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate, getClientIp: () => '127.0.0.1' }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))

import { POST as POSTRoute, GET as GETRoute } from '@/app/api/orders/route'
import { PATCH } from '@/app/api/orders/[id]/route'
const tenantId = randomUUID(), productId = randomUUID(), menuId = randomUUID(), id = randomUUID(), foreign = randomUUID()
const settings = { orders_enabled: true, currency: null, country: 'US' }
const caps = { kds: true, waiterOrdering: true, guestOrdering: true, dineIn: true, tips: true, itemNotes: true, ingredientCustomization: true }
const result = <T>(data: T) => ({ data, error: null })
const repository = {
  tenantSettings: vi.fn(), capabilities: vi.fn(), stripeEnabled: vi.fn(), products: vi.fn(), optionGroups: vi.fn(),
  ingredients: vi.fn(), deliveryZones: vi.fn(), create: vi.fn(), list: vi.fn(), move: vi.fn(), recordAnalytics: vi.fn(),
}
const input = { tenant_id: tenantId, customer_name: 'Guest', customer_phone: '5550100200', items: [{ product_id: productId, quantity: 2, unit_price: 0.01, product_name: 'Forged label' }] }
const request = (body: unknown, path = '/api/orders', method = 'POST') => new Request(`http://localhost${path}`, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json','Idempotency-Key': 'offline-checkout-key' } })
const POST = (body: unknown) => POSTRoute(request(body), undefined)
const GET = () => GETRoute(new Request('http://localhost/api/orders'), undefined)

beforeEach(() => {
  vi.stubEnv('OWNED_ORDER_DATA_ENABLED','true')
  vi.stubEnv('OWNED_PAYMENT_DATA_ENABLED','true')
  mocks.rate.mockResolvedValue({ ok: true }); mocks.effective.mockResolvedValue(null)
  mocks.cookie.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
  mocks.legacy.mockImplementation(() => { throw Error('Legacy order data must not be used') })
  mocks.capabilities.mockImplementation(() => { throw Error('Legacy plan source must not be used') })
  mocks.stripe.mockImplementation(() => { throw Error('Legacy payment source must not be used') })
  mocks.transaction.mockImplementation(async (_tenant: string, _write: boolean, operation: (repo: unknown) => unknown) => operation(repository))
  repository.tenantSettings.mockResolvedValue(result({ id: tenantId, is_active: true, tenant_settings: settings }))
  repository.capabilities.mockResolvedValue(caps); repository.stripeEnabled.mockResolvedValue(false)
  repository.products.mockResolvedValue(result([{ id: productId, tenant_id: tenantId, name: 'Database dish', price: 10,
    is_available: true, menu_id: menuId, menus: { id: menuId, is_active: true, is_private: false, price_multiplier: 1.25 } }]))
  repository.optionGroups.mockResolvedValue(result([])); repository.ingredients.mockResolvedValue(result([]))
  repository.create.mockResolvedValue(result({ id, status: 'pending', total: 25, order_type: 'dine_in', replayed: false }))
  repository.list.mockResolvedValue(result([{ id, tenant_id: tenantId, total: 25, currency: null, order_items: [] }]))
  repository.move.mockResolvedValue({ id, status: 'preparing' })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

describe('owned orders route source selection', () => {
  it('keeps catalog pricing and atomic payload construction on the owned source without legacy data factories', async () => {
    const response = await POST(input)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id, total: 25, requires_payment: false })
    const [order, items, customer] = repository.create.mock.calls[0]
    expect(order).toMatchObject({ tenant_id: tenantId, customer_id: null, total: 25, subtotal: 25, currency: null, idempotency_key: 'offline-checkout-key' })
    expect(order.request_fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(items[0]).toMatchObject({ product_id: productId, product_name: 'Database dish', unit_price: 12.5, quantity: 2 })
    expect(customer).toBeNull()
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.capabilities).not.toHaveBeenCalled(); expect(mocks.stripe).not.toHaveBeenCalled()
  })
  it('retains Stripe-required state and refuses unavailable/private items without an exact verified session', async () => {
    repository.stripeEnabled.mockResolvedValue(true)
    await POST(input)
    expect(repository.create.mock.calls[0][0].status).toBe('awaiting_payment')
    repository.products.mockResolvedValue(result([{ id: productId, name: 'Dish', price: 10, is_available: true, menus: { id: menuId, is_active: true, is_private: true } }]))
    expect((await POST(input)).status).toBe(403)
    expect(repository.create).toHaveBeenCalledTimes(1)
  })
  it('refuses Stripe-required owned orders until the matching payment store is enabled',async()=>{
    vi.stubEnv('OWNED_PAYMENT_DATA_ENABLED','false')
    repository.stripeEnabled.mockResolvedValue(true)
    expect((await POST(input)).status).toBe(503)
    expect(repository.create).not.toHaveBeenCalled();expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('refuses ambiguous overlapping delivery fees instead of depending on restore row ordering', async () => {
    repository.capabilities.mockResolvedValue({ ...caps,delivery: true })
    repository.deliveryZones.mockResolvedValue(result([{ id: randomUUID(),fee_cents:100,zipcode_prefixes:['017'] },{ id: randomUUID(),fee_cents:200,zipcode_prefixes:['01702'] }]))
    expect((await POST({ ...input,order_type:'delivery',delivery_street:'Fixture street',delivery_zipcode:'01702' })).status).toBe(503)
    expect(repository.create).not.toHaveBeenCalled()
  })
  it('blocks selected tied reset/add option pricing before the RPC, and accepts explicit distinct positions', async () => {
    const additive=randomUUID(),reset=randomUUID(),a=randomUUID(),b=randomUUID()
    const groups=[
      { id:additive,product_id:productId,name:'Extras',position:0,type:'multiple',product_options:[{ id:a,name:'Extra',base_price:null,price_modifier:2,is_available:true }] },
      { id:reset,product_id:productId,name:'Size',position:0,type:'single',product_options:[{ id:b,name:'Large',base_price:20,price_modifier:0,is_available:true }] },
    ]
    repository.optionGroups.mockResolvedValue(result(groups))
    const payload={ ...input,items:[{ ...input.items[0],editor_state:{ multiSelections:{ [additive]:[a] },singleSelections:{ [reset]:b } } }] }
    expect((await POST(payload)).status).toBe(503)
    expect(repository.create).not.toHaveBeenCalled()
    repository.optionGroups.mockResolvedValue(result([groups[0],{ ...groups[1],position:1 }]))
    expect((await POST(payload)).status).toBe(200)
    expect(repository.create.mock.calls[0][1][0].unit_price).toBe(25)
  })
  it('keeps authenticated tenant context for KDS and kitchen writes and never trusts a body tenant', async () => {
    mocks.effective.mockResolvedValue({ tenantId, role: 'store-staff' })
    expect((await GET()).status).toBe(200)
    expect(repository.list.mock.calls[0][0]).toEqual({ tenantId, role: 'store-staff' })
    expect((await PATCH(request({ status: 'preparing', tenant_id: foreign }, `/api/orders/${id}`, 'PATCH'), { params: Promise.resolve({ id }) })).status).toBe(200)
    expect(repository.move).toHaveBeenCalledWith({ tenantId, role: 'store-staff' },id,'preparing')
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.analytics).not.toHaveBeenCalled()
  })
  it('preserves anonymous/customer denials and fails closed without a legacy fallback', async () => {
    expect((await GET()).status).toBe(401)
    mocks.effective.mockResolvedValue({ tenantId, role: 'customer' })
    expect((await GET()).status).toBe(403)
    mocks.effective.mockResolvedValue({ tenantId, role: 'store-admin' })
    mocks.transaction.mockRejectedValue(new OrderDataError(503,'Order service is unavailable'))
    expect((await GET()).status).toBe(503)
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
})
