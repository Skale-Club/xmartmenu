import type { Category, Menu } from '@/types/database'
import { MENU_LANGUAGE_CODES } from '@/components/menu/menu-i18n'
import { sanitizeTranslations } from '@/lib/menu-translations'
import { parseCourse } from '@/components/menu/upsell'
import { AdminMenuError, activeAdminMenu, readAdminMenus, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'
import { PUBLIC_MENU_COLUMNS } from './public-menu'

export type CategoryMutation = { kind: 'create'; body: unknown; selectedMenuId?: string }
  | { kind: 'patch'; id: string; body: unknown } | { kind: 'delete'; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const projection = `to_jsonb((SELECT projected FROM (SELECT ${PUBLIC_MENU_COLUMNS.category.split(' ').map(column => `c.${column}`).join(', ')}) projected)) AS row`

function scope(context: AdminMenuContext, write = false) {
  if (!UUID.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)
    || (write && context.role === 'store-staff')) throw new AdminMenuError(403, 'Forbidden')
}
function categoryRows(result: { rows: Record<string, unknown>[] }): Category[] {
  if (result.rows.length > 1000) throw new AdminMenuError(409, 'Category list exceeds the supported limit')
  return result.rows.map(({ row }) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid category projection')
    return row as Category
  })
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 64000) throw new AdminMenuError(400, 'Invalid category')
  return input as Record<string, unknown>
}
export function categoryFields(input: unknown, creating = false): Record<string, unknown> {
  const body = object(input)
  const allowed = ['name', 'description', 'translations', 'course', 'position', 'is_active']
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AdminMenuError(400, 'Invalid category fields')
  const patch: Record<string, unknown> = {}
  for (const key of ['name', 'description', 'position', 'is_active']) if (Object.hasOwn(body, key)) patch[key] = body[key]
  if (creating || 'name' in patch) {
    if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 500) throw new AdminMenuError(400, 'Name is required')
    patch.name = patch.name.trim()
  }
  if ('description' in patch && patch.description !== null && (typeof patch.description !== 'string' || patch.description.length > 10000)) throw new AdminMenuError(400, 'Invalid description')
  if ('position' in patch && (typeof patch.position !== 'number' || !Number.isInteger(patch.position) || patch.position < -2147483648 || patch.position > 2147483647)) throw new AdminMenuError(400, 'Invalid position')
  if ('is_active' in patch && typeof patch.is_active !== 'boolean') throw new AdminMenuError(400, 'Invalid availability')
  if ('translations' in body) patch.translations = sanitizeTranslations(body.translations)
  if ('course' in body) patch.course = parseCourse(body.course)
  if (creating) {
    if (!('description' in patch)) patch.description = null
    if (!('translations' in patch)) patch.translations = {}
    if (!('course' in patch)) patch.course = null
    if (!('is_active' in patch)) patch.is_active = true
  }
  return patch
}
function translationsForMenu(input: unknown, menu: Menu) {
  const allowed = new Set(MENU_LANGUAGE_CODES)
  const languages = Array.isArray(menu.supported_languages) ? menu.supported_languages.filter((item): item is string => typeof item === 'string' && allowed.has(item)) : []
  const sanitized = sanitizeTranslations(input)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return {}
  return Object.fromEntries(Object.entries(sanitized).filter(([language]) => languages.includes(language)))
}

export async function readAdminCategoriesPage(query: AdminMenuQuery, context: AdminMenuContext, selectedMenuId?: string) {
  scope(context)
  const menu = activeAdminMenu(await readAdminMenus(query, context), selectedMenuId)
  if (!menu) return { menu: null, categories: [] as Category[] }
  const categories = categoryRows(await query(`SELECT ${projection} FROM public.categories c
    WHERE c.tenant_id=$1 AND c.menu_id=$2 ORDER BY c.position,c.id LIMIT 1001`, [context.tenantId, menu.id]))
  return { menu, categories }
}

async function findCategory(query: AdminMenuQuery, context: AdminMenuContext, id: string, lock = false) {
  if (!UUID.test(id)) return null
  const category = categoryRows(await query(`SELECT ${projection} FROM public.categories c WHERE c.tenant_id=$1 AND c.id=$2${lock ? ' FOR UPDATE OF c' : ''}`, [context.tenantId, id]))[0]
  if (!category) return null
  const menu = await query('SELECT id FROM public.menus WHERE id=$1 AND tenant_id=$2', [category.menu_id, context.tenantId])
  if (menu.rows.length !== 1) throw new AdminMenuError(409, 'Category has an invalid menu reference')
  return category
}

async function guardCategoryDeletion(query: AdminMenuQuery, context: AdminMenuContext, id: string) {
  await query('LOCK TABLE public.categories,public.products,public.menu_events IN ROW EXCLUSIVE MODE')
  const graph = await query(`SELECT child.relname AS child,ns.nspname AS schema,ca.attname AS column,pa.attname AS parent_column,
    fk.confdeltype AS action,cardinality(fk.conkey) AS columns,fk.convalidated AS validated
    FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=fk.confkey[1]
    WHERE fk.contype='f' AND fk.confrelid='public.categories'::regclass AND fk.confdeltype IN ('c','n','d') LIMIT 21`)
  if (graph.rows.length !== 2 || graph.rows.some(row => row.schema !== 'public' || row.columns !== 1 || row.validated !== true || row.action !== 'n'
    || !((row.child === 'products' && row.column === 'category_id' && row.parent_column === 'id')
      || (row.child === 'menu_events' && row.column === 'category_id' && row.parent_column === 'id')))) {
    throw new AdminMenuError(409, 'Category has unreviewed dependent references')
  }
  const products = await query('SELECT id,tenant_id FROM public.products WHERE category_id=$1 ORDER BY id LIMIT 5001 FOR UPDATE', [id])
  const events = await query('SELECT id,tenant_id FROM public.menu_events WHERE category_id=$1 ORDER BY id LIMIT 5001 FOR UPDATE', [id])
  if (products.rows.length + events.rows.length > 5000 || [...products.rows, ...events.rows].some(row => row.tenant_id !== context.tenantId)) {
    throw new AdminMenuError(409, 'Category has inconsistent tenant references')
  }
}

/** Mutations share the menu lock, so menu deletion/selection and category writes serialize per tenant. */
export async function mutateAdminCategory(query: AdminMenuQuery, context: AdminMenuContext, mutation: CategoryMutation): Promise<Category | { ok: true }> {
  scope(context, true)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-menus:${context.tenantId}`])
  if (mutation.kind === 'create') {
    const body = object(mutation.body)
    if (Object.keys(body).some(key => !['name', 'description', 'translations', 'course', 'position', 'menu_id'].includes(key))) throw new AdminMenuError(400, 'Invalid category fields')
    const menus = await readAdminMenus(query, context)
    const requestedMenu = body.menu_id
    if (requestedMenu !== undefined && requestedMenu !== null && (typeof requestedMenu !== 'string' || !UUID.test(requestedMenu))) throw new AdminMenuError(400, 'Invalid menu')
    const menu = requestedMenu ? menus.find(item => item.id === requestedMenu) ?? null : activeAdminMenu(menus, mutation.selectedMenuId)
    if (!menu) throw new AdminMenuError(400, 'No menu selected')
    const editable: Record<string, unknown> = { ...body, translations: translationsForMenu(body.translations, menu) }
    delete editable.menu_id
    const patch = categoryFields(editable, true)
    const positionResult = await query('SELECT coalesce(max(position)::bigint,-1)+1 AS next FROM public.categories WHERE tenant_id=$1 AND menu_id=$2', [context.tenantId, menu.id])
    const position = Number(positionResult.rows[0]?.next)
    if (!Number.isInteger(position) || position < -2147483648 || position > 2147483647) throw new AdminMenuError(409, 'Category position is unavailable')
    const created = categoryRows(await query(`INSERT INTO public.categories AS c(tenant_id,menu_id,name,description,position,translations,course,is_active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${projection}`,
      [context.tenantId, menu.id, patch.name, patch.description, position, JSON.stringify(patch.translations), patch.course, patch.is_active]))[0]
    if (!created) throw new Error('Category insert failed')
    return created
  }
  const current = await findCategory(query, context, mutation.id, true)
  if (!current) throw new AdminMenuError(404, 'Category not found')
  if (mutation.kind === 'delete') {
    await guardCategoryDeletion(query, context, mutation.id)
    await query('DELETE FROM public.categories WHERE tenant_id=$1 AND id=$2', [context.tenantId, mutation.id])
    return { ok: true }
  }
  const patch = categoryFields(mutation.body)
  if ('translations' in patch) {
    const menu = (await readAdminMenus(query, context)).find(item => item.id === current.menu_id)
    if (!menu) throw new AdminMenuError(409, 'Category has an invalid menu reference')
    patch.translations = translationsForMenu(patch.translations, menu)
  }
  const entries = Object.entries(patch)
  if (!entries.length) return current
  const updated = categoryRows(await query(`UPDATE public.categories c SET ${entries.map(([key], index) => `${key}=$${index + 3}`).join(', ')}
    WHERE c.tenant_id=$1 AND c.id=$2 RETURNING ${projection}`,
    [context.tenantId, mutation.id, ...entries.map(([key, value]) => key === 'translations' ? JSON.stringify(value) : value)]))[0]
  if (!updated) throw new AdminMenuError(404, 'Category not found')
  return updated
}
