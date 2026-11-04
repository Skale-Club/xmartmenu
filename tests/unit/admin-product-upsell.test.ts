import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { updateAdminProductUpsellIds } from '@/lib/data/admin-product-upsell'

const tenantId = randomUUID()
const productId = randomUUID()
const menuId = randomUUID()
const suggestionId = randomUUID()

function queryFor(candidateIds: string[] = [suggestionId]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT id,menu_id')) return { rows: [{ id: productId, menu_id: menuId }] }
    if (sql.includes('SELECT id FROM public.products')) return { rows: candidateIds.map(id => ({ id })) }
    if (sql.startsWith('UPDATE public.products')) return { rows: [{ id: productId }] }
    return { rows: [] }
  })
  return query
}

describe('owned product upsell mutation', () => {
  it('validates same-tenant candidates and updates the ordered list', async () => {
    const query = queryFor()
    await expect(updateAdminProductUpsellIds(query, { tenantId, role: 'store-admin' }, productId, [suggestionId]))
      .resolves.toEqual({ ok: true, ids: [suggestionId] })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('tenant_id=$1 AND id=ANY'), [tenantId, [suggestionId], menuId])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET upsell_product_ids=$3::uuid[]'), [tenantId, productId, [suggestionId]])
  })

  it('rejects cross-menu candidates without updating the product', async () => {
    const query = queryFor([])
    await expect(updateAdminProductUpsellIds(query, { tenantId, role: 'store-admin' }, productId, [suggestionId]))
      .rejects.toMatchObject({ status: 400 })
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE public.products'), expect.anything())
  })

  it('rejects duplicates and self-suggestions', async () => {
    const query = queryFor()
    await expect(updateAdminProductUpsellIds(query, { tenantId, role: 'store-admin' }, productId, [suggestionId, suggestionId]))
      .rejects.toMatchObject({ status: 400 })
    await expect(updateAdminProductUpsellIds(query, { tenantId, role: 'store-admin' }, productId, [productId]))
      .rejects.toMatchObject({ status: 400 })
  })

  it('limits suggestions to eight UUIDs and refuses staff writes before SQL', async () => {
    const query = queryFor()
    const tooMany = Array.from({ length: 9 }, () => randomUUID())
    await expect(updateAdminProductUpsellIds(query, { tenantId, role: 'store-admin' }, productId, tooMany))
      .rejects.toMatchObject({ status: 400 })
    await expect(updateAdminProductUpsellIds(query, { tenantId, role: 'store-staff' }, productId, []))
      .rejects.toBeInstanceOf(AdminMenuError)
    expect(query).not.toHaveBeenCalled()
  })
})
