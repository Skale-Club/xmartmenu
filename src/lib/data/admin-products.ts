import type { Product } from '@/types/database'
import { activeAdminMenu, AdminMenuError, readAdminMenus, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'
import { PUBLIC_MENU_COLUMNS } from './public-menu'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const projection = `to_jsonb((SELECT projected FROM (SELECT ${PUBLIC_MENU_COLUMNS.product.split(' ').map(key => `p.${key}`).join(',')}) projected))
  || jsonb_build_object('category',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'name',c.name) END) AS row`
const categoryJoin = 'LEFT JOIN public.categories c ON c.id=p.category_id AND c.tenant_id=p.tenant_id AND c.menu_id IS NOT DISTINCT FROM p.menu_id'
export type ProductMutation = { kind: 'create'; body: unknown; selectedMenuId?: string }
  | { kind: 'patch'; id: string; body: unknown } | { kind: 'delete'; id: string }
export type AdminProduct = Product & { category: { id: string; name: string } | null }

function scope(context: AdminMenuContext, write = false) {
  if (!uuid.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)
    || (write && context.role === 'store-staff')) throw new AdminMenuError(403, 'Forbidden')
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 64000) throw new AdminMenuError(400, 'Invalid product')
  return input as Record<string, unknown>
}
function resultRows(result: { rows: Record<string, unknown>[] }): AdminProduct[] {
  if (result.rows.length > 2000) throw new AdminMenuError(409, 'Product catalog exceeds the supported limit')
  return result.rows.map(({ row }) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid product result')
    return row as AdminProduct
  })
}
function validImage(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password }
  catch { return false }
}
export function productPatch(input: unknown, creating = false) {
  const body = object(input), patch: Record<string, unknown> = {}
  const allowed = ['name', 'description', 'price', 'original_price', 'category_id', 'image_url', 'image_urls', 'is_available', 'is_featured', 'show_in_feed', 'tags']
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AdminMenuError(400, 'Invalid product fields')
  for (const key of allowed) if (Object.hasOwn(body, key)) patch[key] = body[key]
  if (creating || 'name' in patch) {
    if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 500) throw new AdminMenuError(400, 'Name is required')
    patch.name = patch.name.trim()
  }
  if ('description' in patch && patch.description !== null && (typeof patch.description !== 'string' || patch.description.length > 10000)) throw new AdminMenuError(400, 'Invalid description')
  if (creating && !('price' in patch)) throw new AdminMenuError(400, 'Price is required')
  for (const key of ['price', 'original_price']) {
    if (!(key in patch) || (key === 'original_price' && patch[key] === null)) continue
    if (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]) || patch[key] < 0 || patch[key] > 99999999.99) throw new AdminMenuError(400, 'Invalid product price')
  }
  if ('category_id' in patch && patch.category_id !== null && (typeof patch.category_id !== 'string' || !uuid.test(patch.category_id))) throw new AdminMenuError(400, 'Invalid category')
  for (const key of ['is_available', 'is_featured', 'show_in_feed']) if (key in patch && typeof patch[key] !== 'boolean') throw new AdminMenuError(400, 'Invalid product setting')
  if ('image_url' in patch && patch.image_url !== null && !validImage(patch.image_url)) throw new AdminMenuError(400, 'Invalid image URL')
  if ('image_urls' in patch && (!Array.isArray(patch.image_urls) || patch.image_urls.length > 20 || !patch.image_urls.every(validImage))) throw new AdminMenuError(400, 'Invalid images')
  if ('tags' in patch && (!Array.isArray(patch.tags) || patch.tags.length > 50 || patch.tags.some(tag => typeof tag !== 'string' || tag.length > 100))) throw new AdminMenuError(400, 'Invalid product tags')
  return patch
}
async function findProduct(query: AdminMenuQuery, context: AdminMenuContext, id: string, lock = false) {
  if (!uuid.test(id)) throw new AdminMenuError(404, 'Product not found')
  const product = resultRows(await query(`SELECT ${projection} FROM public.products p ${categoryJoin}
    WHERE p.tenant_id=$1 AND p.id=$2${lock ? ' FOR UPDATE OF p' : ''}`, [context.tenantId, id]))[0]
  if (!product) throw new AdminMenuError(404, 'Product not found')
  return product
}
async function validateCategory(query: AdminMenuQuery, context: AdminMenuContext, category: unknown, menu: string | null) {
  if (category === null || category === undefined) return
  const result = await query('SELECT id FROM public.categories WHERE tenant_id=$1 AND id=$2 AND menu_id IS NOT DISTINCT FROM $3::uuid FOR SHARE', [context.tenantId, category, menu])
  if (result.rows.length !== 1) throw new AdminMenuError(400, 'Category is unavailable for this menu')
}
export async function readProductsPage(query: AdminMenuQuery, context: AdminMenuContext, selectedMenuId?: string) {
  scope(context)
  const menu = activeAdminMenu(await readAdminMenus(query, context), selectedMenuId)
  const settings = (await query('SELECT currency,custom_tags FROM public.tenant_settings WHERE tenant_id=$1', [context.tenantId])).rows[0]
  const products = menu ? resultRows(await query(`SELECT ${projection} FROM public.products p ${categoryJoin}
    WHERE p.tenant_id=$1 AND p.menu_id=$2 ORDER BY p.position,p.id LIMIT 2001`, [context.tenantId, menu.id])) : []
  const categories = menu ? (await query('SELECT id,name FROM public.categories WHERE tenant_id=$1 AND menu_id=$2 AND is_active=true ORDER BY position,id LIMIT 1001', [context.tenantId, menu.id])).rows : []
  if (categories.length > 1000) throw new AdminMenuError(409, 'Category catalog exceeds the supported limit')
  return { products, categories: categories as Array<{ id: string; name: string }>, menu, settings: {
    currency: typeof settings?.currency === 'string' ? settings.currency : 'USD',
    custom_tags: Array.isArray(settings?.custom_tags) ? settings.custom_tags.filter((tag): tag is string => typeof tag === 'string') : [],
  } }
}
async function guardProductDeletion(query: AdminMenuQuery, context: AdminMenuContext, id: string) {
  await query('LOCK TABLE public.products,public.product_option_groups,public.product_options,public.product_ingredients,public.product_media,public.menu_events IN ROW EXCLUSIVE MODE')
  const reviewed = new Set(['product_option_groups:product_id:products:id:c', 'product_ingredients:product_id:products:id:c',
    'product_media:product_id:products:id:c', 'menu_events:product_id:products:id:n', 'product_options:group_id:product_option_groups:id:c'])
  const graph = await query(`SELECT cn.nspname AS schema,concat_ws(':',child.relname,ca.attname,parent.relname,pa.attname,fk.confdeltype) AS edge,
    cardinality(fk.conkey) AS columns,fk.convalidated AS validated FROM pg_constraint fk
    JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=fk.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=fk.confkey[1]
    WHERE fk.contype='f' AND pn.nspname='public' AND parent.relname IN ('products','product_option_groups') AND fk.confdeltype IN ('c','n','d') LIMIT 21`)
  if (graph.rows.length !== reviewed.size || new Set(graph.rows.map(row => row.edge)).size !== reviewed.size
    || graph.rows.some(row => row.schema !== 'public' || row.columns !== 1 || row.validated !== true || !reviewed.has(String(row.edge)))) throw new AdminMenuError(409, 'Product has unreviewed dependent references')
  const groups = await query('SELECT id,tenant_id FROM public.product_option_groups WHERE product_id=$1 ORDER BY id LIMIT 1001 FOR UPDATE', [id])
  if (groups.rows.length > 1000 || groups.rows.some(row => row.tenant_id !== context.tenantId)) throw new AdminMenuError(409, 'Product has inconsistent tenant references')
  const groupIds = groups.rows.map(row => row.id)
  const options = await query('SELECT tenant_id FROM public.product_options WHERE group_id=ANY($1::uuid[]) ORDER BY id LIMIT 5001 FOR UPDATE', [groupIds])
  const links = await query(`SELECT pi.tenant_id,i.tenant_id AS ingredient_tenant FROM public.product_ingredients pi JOIN public.ingredients i ON i.id=pi.ingredient_id
    WHERE pi.product_id=$1 ORDER BY pi.ingredient_id LIMIT 5001 FOR UPDATE OF pi,i`, [id])
  const media = await query('SELECT tenant_id FROM public.product_media WHERE product_id=$1 ORDER BY id LIMIT 5001 FOR UPDATE', [id])
  const events = await query('SELECT tenant_id FROM public.menu_events WHERE product_id=$1 ORDER BY id LIMIT 5001 FOR UPDATE', [id])
  if ([options, links, media, events].some(result => result.rows.length > 5000 || result.rows.some(row => row.tenant_id !== context.tenantId))
    || links.rows.some(row => row.ingredient_tenant !== context.tenantId)) throw new AdminMenuError(409, 'Product has inconsistent tenant references')
}
/** Caller supplies one bounded transaction; never retries an interrupted write. */
export async function mutateAdminProduct(query: AdminMenuQuery, context: AdminMenuContext, mutation: ProductMutation): Promise<AdminProduct | { ok: true }> {
  scope(context, true)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-menus:${context.tenantId}`])
  if (mutation.kind === 'create') {
    const { expectedMenuId: expected, ...fields } = object(mutation.body)
    const patch = productPatch(fields, true)
    const menu = activeAdminMenu(await readAdminMenus(query, context), mutation.selectedMenuId)
    if (!menu || typeof expected !== 'string' || expected !== menu.id) throw new AdminMenuError(409, 'The selected menu changed; reload before creating the product')
    const parent = await query('SELECT id FROM public.menus WHERE tenant_id=$1 AND id=$2 FOR SHARE', [context.tenantId, menu.id])
    if (parent.rows.length !== 1) throw new AdminMenuError(409, 'The selected menu changed; reload before creating the product')
    await validateCategory(query, context, patch.category_id, menu.id)
    const row = (await query('SELECT coalesce(max(position)::bigint,-1)+1 AS next FROM public.products WHERE tenant_id=$1 AND menu_id=$2', [context.tenantId, menu.id])).rows[0]
    const position = Number(row?.next)
    if (!Number.isInteger(position) || position < 0 || position > 2147483647) throw new AdminMenuError(409, 'Product position is unavailable')
    const entries = Object.entries(patch), columns = entries.map(([key]) => key), values = entries.map(([, value]) => value)
    const created = await query(`INSERT INTO public.products(tenant_id,menu_id,position,${columns.join(',')}) VALUES($1,$2,$3,${values.map((_, i) => `$${i + 4}`).join(',')}) RETURNING id`, [context.tenantId, menu.id, position, ...values])
    const id = created.rows[0]?.id
    if (typeof id !== 'string') throw new Error('Product insert failed')
    return findProduct(query, context, id)
  }
  const current = await findProduct(query, context, mutation.id, true)
  if (mutation.kind === 'delete') {
    await guardProductDeletion(query, context, mutation.id)
    await query('DELETE FROM public.products WHERE tenant_id=$1 AND id=$2', [context.tenantId, mutation.id])
    return { ok: true }
  }
  const patch = productPatch(mutation.body)
  await validateCategory(query, context, patch.category_id, current.menu_id)
  const entries = Object.entries(patch)
  if (entries.length) await query(`UPDATE public.products SET ${entries.map(([key], index) => `${key}=$${index + 3}`).join(',')},updated_at=now()
    WHERE tenant_id=$1 AND id=$2`, [context.tenantId, mutation.id, ...entries.map(([, value]) => value)])
  return findProduct(query, context, mutation.id)
}
