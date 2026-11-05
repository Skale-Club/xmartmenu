import type { AdminMenuQuery } from './admin-menus'

/**
 * Everything the waiter screen reads, from the owned database. One tenant by
 * slug; bounded lists. No Supabase client: the legacy copy is stale.
 */
export async function readOwnedWaiterData(query: AdminMenuQuery, slug: string) {
  const tenants = await query(`SELECT t.id,t.name,t.slug,to_jsonb(s) AS settings FROM public.tenants t
    LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.slug=$1 AND t.is_active LIMIT 2`, [slug])
  if (tenants.rows.length !== 1) return null
  const tenant = tenants.rows[0] as { id: string; name: string; slug: string; settings: Record<string, unknown> | null }
  const tables = await query(`SELECT to_jsonb(r) AS row FROM public.restaurant_tables r WHERE r.tenant_id=$1 AND r.is_active ORDER BY r.position,r.id LIMIT 1001`, [tenant.id])
  // Default menu, else the first active one (same fallback as the public menu).
  const menus = await query(`SELECT id FROM public.menus WHERE tenant_id=$1 AND is_active ORDER BY is_default DESC,position,id LIMIT 1`, [tenant.id])
  const menuId = (menus.rows[0]?.id as string | undefined) ?? null
  const categories = menuId ? await query(`SELECT to_jsonb(c) AS row FROM public.categories c WHERE c.menu_id=$1 AND c.tenant_id=$2 AND c.is_active ORDER BY c.position,c.id LIMIT 1001`, [menuId, tenant.id]) : { rows: [] }
  const products = menuId ? await query(`SELECT to_jsonb(p) AS row FROM public.products p WHERE p.menu_id=$1 AND p.tenant_id=$2 AND p.is_available ORDER BY p.position,p.id LIMIT 2001`, [menuId, tenant.id]) : { rows: [] }
  const productIds = products.rows.map(r => (r.row as { id: string }).id)
  const groups = productIds.length ? await query(`SELECT to_jsonb(g) || jsonb_build_object('options',coalesce((
      SELECT jsonb_agg(to_jsonb(o) ORDER BY o.position,o.id) FROM public.product_options o WHERE o.group_id=g.id AND o.is_available),'[]'::jsonb)) AS row
    FROM public.product_option_groups g WHERE g.product_id=ANY($1::uuid[]) ORDER BY g.position,g.id LIMIT 5001`, [productIds]) : { rows: [] }
  const ingredients = productIds.length ? await query(`SELECT to_jsonb(pi) || jsonb_build_object('ingredient',to_jsonb(i)) AS row
    FROM public.product_ingredients pi JOIN public.ingredients i ON i.id=pi.ingredient_id
    WHERE pi.product_id=ANY($1::uuid[]) ORDER BY pi.position LIMIT 10001`, [productIds]) : { rows: [] }
  const orders = await query(`SELECT id,table_name,status FROM public.orders WHERE tenant_id=$1
    AND status IN ('pending','paid','preparing','ready') AND table_name IS NOT NULL LIMIT 1001`, [tenant.id])
  return {
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, settings: tenant.settings,
    tables: tables.rows.map(r => r.row), categories: categories.rows.map(r => r.row), products: products.rows.map(r => r.row),
    groups: groups.rows.map(r => r.row as { product_id: string }), ingredients: ingredients.rows.map(r => r.row as { product_id: string }),
    activeOrders: orders.rows,
  }
}
