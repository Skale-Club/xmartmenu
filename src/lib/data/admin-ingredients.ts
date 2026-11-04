import type { Ingredient } from '@/types/database'
import { AdminMenuError, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'

export const ownedCatalogEnabled = (env: Record<string, string | undefined> = process.env) => env.OWNED_ADMIN_CATALOG_ENABLED === 'true'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const projection = `to_jsonb((SELECT projected FROM (SELECT i.id,i.tenant_id,i.name,i.image_url,
  i.default_extra_price,i.default_add_price,i.is_available,i.position,i.translations,i.created_at,i.updated_at) projected)) AS row`
export type IngredientMutation = { kind: 'create'; body: unknown } | { kind: 'patch'; id: string; body: unknown }
  | { kind: 'delete'; id: string } | { kind: 'reorder'; body: unknown }

function scope(context: AdminMenuContext, write = false) {
  if (!uuid.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)
    || (write && context.role === 'store-staff')) throw new AdminMenuError(403, 'Forbidden')
}
function rows(result: { rows: Record<string, unknown>[] }): Ingredient[] {
  if (result.rows.length > 1000) throw new AdminMenuError(409, 'Ingredient catalog exceeds the supported limit')
  return result.rows.map(({ row }) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid ingredient result')
    return row as Ingredient
  })
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 4096) throw new AdminMenuError(400, 'Invalid ingredient')
  return input as Record<string, unknown>
}
export function ingredientPatch(input: unknown, creating = false) {
  const body = object(input), patch: Record<string, unknown> = {}
  const allowed = ['name', 'default_extra_price', 'default_add_price', 'is_available']
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AdminMenuError(400, 'Invalid ingredient fields')
  for (const key of allowed) if (Object.hasOwn(body, key)) patch[key] = body[key]
  if (creating || 'name' in patch) {
    if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 500) throw new AdminMenuError(400, 'Name is required')
    patch.name = patch.name.trim()
  }
  for (const key of ['default_extra_price', 'default_add_price']) {
    if (!(key in patch) && creating) patch[key] = 0
    if (key in patch && (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]) || patch[key] < 0 || patch[key] > 99999999.99)) throw new AdminMenuError(400, 'Invalid ingredient price')
  }
  if (!('is_available' in patch) && creating) patch.is_available = true
  if ('is_available' in patch && typeof patch.is_available !== 'boolean') throw new AdminMenuError(400, 'Invalid availability')
  return patch
}
export async function readAdminIngredients(query: AdminMenuQuery, context: AdminMenuContext) {
  scope(context)
  return rows(await query(`SELECT ${projection} FROM public.ingredients i WHERE i.tenant_id=$1 ORDER BY i.position,i.id LIMIT 1001`, [context.tenantId]))
}
export async function readIngredientsPage(query: AdminMenuQuery, context: AdminMenuContext) {
  scope(context)
  const result = await query('SELECT currency,ingredient_customization_enabled FROM public.tenant_settings WHERE tenant_id=$1', [context.tenantId])
  const settings = result.rows[0]
  return { ingredients: await readAdminIngredients(query, context), settings: {
    currency: typeof settings?.currency === 'string' && settings.currency ? settings.currency : 'USD',
    ingredient_customization_enabled: settings?.ingredient_customization_enabled === true,
  } }
}
async function find(query: AdminMenuQuery, context: AdminMenuContext, id: string) {
  if (!uuid.test(id)) throw new AdminMenuError(404, 'Ingredient not found')
  const current = rows(await query(`SELECT ${projection} FROM public.ingredients i WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE OF i`, [context.tenantId, id]))[0]
  if (!current) throw new AdminMenuError(404, 'Ingredient not found')
  return current
}
async function guardDeletion(query: AdminMenuQuery, context: AdminMenuContext, id: string) {
  // Keep the reviewed cascading graph stable until COMMIT. Parent/child locks
  // prevent a concurrent reference or tenant change from escaping the check.
  await query('LOCK TABLE public.ingredients,public.product_ingredients IN ROW EXCLUSIVE MODE')
  const graph = await query(`SELECT child.relname AS child,ns.nspname AS schema,ca.attname AS column,pa.attname AS parent_column,
    fk.confdeltype AS action,cardinality(fk.conkey) AS columns,fk.convalidated AS validated
    FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=fk.confkey[1]
    WHERE fk.contype='f' AND fk.confrelid='public.ingredients'::regclass AND fk.confdeltype IN ('c','n','d') LIMIT 21`)
  if (graph.rows.length !== 1 || graph.rows.some(row => row.child !== 'product_ingredients' || row.schema !== 'public'
    || row.column !== 'ingredient_id' || row.parent_column !== 'id' || row.action !== 'c' || row.columns !== 1 || row.validated !== true)) throw new AdminMenuError(409, 'Ingredient has unreviewed dependent references')
  const links = await query(`SELECT pi.tenant_id,p.tenant_id AS product_tenant FROM public.product_ingredients pi
    JOIN public.products p ON p.id=pi.product_id WHERE pi.ingredient_id=$1 ORDER BY pi.product_id LIMIT 5001 FOR UPDATE OF pi,p`, [id])
  if (links.rows.length > 5000 || links.rows.some(row => row.tenant_id !== context.tenantId || row.product_tenant !== context.tenantId)) throw new AdminMenuError(409, 'Ingredient has inconsistent tenant references')
}
/** The caller supplies a bounded transaction. Interrupted writes are never retried. */
export async function mutateAdminIngredient(query: AdminMenuQuery, context: AdminMenuContext, mutation: IngredientMutation): Promise<Ingredient | Ingredient[] | { ok: true }> {
  scope(context, true)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-menus:${context.tenantId}`])
  if (mutation.kind === 'create') {
    const patch = ingredientPatch(mutation.body, true)
    const position = await query('SELECT coalesce(max(position)::bigint,-1)+1 AS next FROM public.ingredients WHERE tenant_id=$1', [context.tenantId])
    const next = Number(position.rows[0]?.next)
    if (!Number.isInteger(next) || next < 0 || next > 2147483647) throw new AdminMenuError(409, 'Ingredient position is unavailable')
    const created = rows(await query(`INSERT INTO public.ingredients AS i(tenant_id,name,default_extra_price,default_add_price,is_available,position)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING ${projection}`, [context.tenantId, patch.name, patch.default_extra_price, patch.default_add_price, patch.is_available, next]))[0]
    if (!created) throw new Error('Ingredient insert failed')
    return created
  }
  if (mutation.kind === 'reorder') {
    const body = object(mutation.body)
    if (Object.keys(body).some(key => !['firstId', 'secondId'].includes(key)) || typeof body.firstId !== 'string'
      || typeof body.secondId !== 'string' || body.firstId === body.secondId) throw new AdminMenuError(400, 'Invalid ingredient order')
    const ids = [body.firstId, body.secondId].sort()
    const first = await find(query, context, ids[0]), second = await find(query, context, ids[1])
    await query(`UPDATE public.ingredients SET position=CASE id WHEN $2::uuid THEN $4::int ELSE $5::int END,updated_at=now()
      WHERE tenant_id=$1 AND id=ANY($3::uuid[])`, [context.tenantId, first.id, ids, second.position, first.position])
    return readAdminIngredients(query, context)
  }
  const current = await find(query, context, mutation.id)
  if (mutation.kind === 'delete') {
    await guardDeletion(query, context, mutation.id)
    await query('DELETE FROM public.ingredients WHERE tenant_id=$1 AND id=$2', [context.tenantId, mutation.id])
    return { ok: true }
  }
  const entries = Object.entries(ingredientPatch(mutation.body))
  if (!entries.length) return current
  const updated = rows(await query(`UPDATE public.ingredients i SET ${entries.map(([key], index) => `${key}=$${index + 3}`).join(',')},updated_at=now()
    WHERE i.tenant_id=$1 AND i.id=$2 RETURNING ${projection}`, [context.tenantId, mutation.id, ...entries.map(([, value]) => value)]))[0]
  if (!updated) throw new AdminMenuError(404, 'Ingredient not found')
  return updated
}
