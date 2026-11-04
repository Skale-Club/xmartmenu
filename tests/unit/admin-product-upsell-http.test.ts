import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), effective: vi.fn(), capabilities: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/data/admin-ingredients', () => ({ ownedCatalogEnabled: mocks.enabled }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/tenant-plan', () => ({ getTenantCapabilities: mocks.capabilities }))
vi.mock('@/lib/data/admin-product-upsell-runtime', () => ({ updateOwnedProductUpsellIds: mocks.update }))

import { PATCH } from '@/app/api/admin/products/[id]/upsell/route'

const tenantId = randomUUID()
const productId = randomUUID()
const context = { tenantId, role: 'store-admin' as const }
const params = { params: Promise.resolve({ id: productId }) }
const request = (body: unknown) => new Request(`http://localhost/api/admin/products/${productId}/upsell`, {
  method: 'PATCH', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  mocks.enabled.mockReturnValue(true)
  mocks.effective.mockResolvedValue(context)
  mocks.capabilities.mockResolvedValue({ plan: { payments: true } })
  mocks.update.mockResolvedValue({ ok: true })
})
afterEach(() => vi.resetAllMocks())

describe('owned product suggestions route', () => {
  it('requires a live payments entitlement before writing', async () => {
    mocks.capabilities.mockResolvedValue({ plan: { payments: false } })
    const response = await PATCH(request({ upsell_product_ids: [] }), params)
    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('permits an entitled admin and forwards only the suggestion IDs', async () => {
    const ids = [randomUUID()]
    const response = await PATCH(request({ upsell_product_ids: ids }), params)
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(context, productId, ids)
  })

  it('rejects staff before entitlement lookup or mutation', async () => {
    mocks.effective.mockResolvedValue({ ...context, role: 'store-staff' })
    const response = await PATCH(request({ upsell_product_ids: [] }), params)
    expect(response.status).toBe(403)
    expect(mocks.capabilities).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
