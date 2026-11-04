import { AdminMenuError, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const MAX_ADMIN_UPSELL_PICKS = 8

function validateIds(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ADMIN_UPSELL_PICKS
    || value.some(id => typeof id !== 'string' || !uuid.test(id))) {
    throw new AdminMenuError(400, 'Invalid product suggestions')
  }
  const ids = value.map(id => (id as string).toLowerCase())
  if (new Set(ids).size !== ids.length) throw new AdminMenuError(400, 'Product suggestions must be unique')
  return ids
}

export async function updateAdminProductUpsellIds(
  query: AdminMenuQuery,
  context: AdminMenuContext,
  productId: string,
  value: unknown,
) {
  if (!uuid.test(context.tenantId) || !uuid.test(productId)
    || !['superadmin', 'store-admin'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')

  const ids = validateIds(value)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-menus:${context.tenantId}`])
  const product = (await query('SELECT id,menu_id FROM public.products WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [context.tenantId, productId.toLowerCase()])).rows[0]
  if (!product) throw new AdminMenuError(404, 'Product not found')
  if (ids.includes(productId.toLowerCase())) throw new AdminMenuError(400, 'A product cannot suggest itself')

  if (ids.length) {
    const candidates = await query(`SELECT id FROM public.products
      WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR menu_id=$3)
      ORDER BY id FOR SHARE`, [context.tenantId, ids, product.menu_id ?? null])
    if (candidates.rows.length !== ids.length) throw new AdminMenuError(400, 'Suggestions must belong to this tenant and menu')
  }

  const updated = await query('UPDATE public.products SET upsell_product_ids=$3::uuid[],updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id', [context.tenantId, productId.toLowerCase(), ids])
  if (updated.rows.length !== 1) throw new AdminMenuError(404, 'Product not found')
  return { ok: true, ids }
}
