import { AdminMenuError, type AdminMenuQuery } from './admin-menus'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Products of one menu for the AI image-seed picker: same projection and order as the legacy route. */
export async function readTenantProductPicker(query: AdminMenuQuery, tenantId: string, menuId: string) {
  if (!UUID.test(tenantId) || !UUID.test(menuId)) throw new AdminMenuError(400, 'Invalid identifier')
  const { rows } = await query(
    'SELECT id, name, image_url, category_id FROM public.products WHERE tenant_id=$1 AND menu_id=$2 ORDER BY position ASC, id LIMIT 5001', [tenantId, menuId])
  if (rows.length > 5000) throw new AdminMenuError(409, 'Product list exceeds the supported limit')
  return rows
}
