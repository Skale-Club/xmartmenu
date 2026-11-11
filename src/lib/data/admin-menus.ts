import type { Menu, UserRole } from '@/types/database'
import { MENU_LANGUAGE_CODES } from '@/components/menu/menu-i18n'
import { slugify } from '../utils'
import { PUBLIC_MENU_COLUMNS } from './public-menu'

export type AdminMenuQuery = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
export type AdminMenuContext = { tenantId: string; role: UserRole }
export type AdminMenuMutation = { kind: 'create'; body: unknown } | { kind: 'patch'; id: string; body: unknown } | { kind: 'delete'; id: string }
export class AdminMenuError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const adminMenusOwned = (env: Record<string, string | undefined> = process.env) => env.OWNED_ADMIN_MENUS_ENABLED === 'true'
const columns = PUBLIC_MENU_COLUMNS.menu.split(' ').map(column => `m.${column}`).join(', ')
// Staging fields read through to_jsonb(m): null until the schema step adds them
// (docs/owned-schema/20261111120000_menu_staging.sql).
const projected = `to_jsonb((SELECT projected FROM (SELECT ${columns}) projected))
  || jsonb_build_object('staging_of', to_jsonb(m)->'staging_of', 'preview_token', to_jsonb(m)->'preview_token', 'replaced_at', to_jsonb(m)->'replaced_at') AS row`
export const ADMIN_MENU_PROJECTION = projected
function tenantScope(context: AdminMenuContext) {
  if (!UUID.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')
}
function dto(rows: Record<string, unknown>[]): Menu[] {
  if (rows.length > 1000) throw new Error('Menu limit exceeded')
  return rows.map(({ row }) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid menu')
    return row as Menu
  })
}
export async function readAdminMenus(query: AdminMenuQuery, context: AdminMenuContext): Promise<Menu[]> {
  tenantScope(context)
  return dto((await query(`SELECT ${projected} FROM public.menus m WHERE m.tenant_id=$1 ORDER BY m.position, m.id LIMIT 1001`, [context.tenantId])).rows)
}
export async function findAdminMenu(query: AdminMenuQuery, context: AdminMenuContext, id: string, lock = false): Promise<Menu | null> {
  tenantScope(context)
  if (!UUID.test(id)) return null
  return dto((await query(`SELECT ${projected} FROM public.menus m WHERE m.tenant_id=$1 AND m.id=$2${lock ? ' FOR UPDATE OF m' : ''}`, [context.tenantId, id])).rows)[0] ?? null
}
/** Back-office selection deliberately includes inactive menus, as before. */
export function activeAdminMenu(menus: Menu[], selected?: string): Menu | null {
  const chosen = menus.find(menu => menu.id === selected)
  if (chosen) return chosen
  const defaults = menus.filter(menu => menu.is_default)
  return (defaults.length === 1 ? defaults[0] : menus[0]) ?? null
}
function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AdminMenuError(400, 'Invalid menu')
  if (JSON.stringify(body).length > 64000) throw new AdminMenuError(400, 'Invalid menu')
  return body as Record<string, unknown>
}
function languages(language: unknown, supported: unknown) {
  const allowed: readonly string[] = MENU_LANGUAGE_CODES
  const base = typeof language === 'string' && allowed.includes(language) ? language : 'en'
  const result = [...new Set((Array.isArray(supported) ? supported : [base]).filter((value): value is string => typeof value === 'string' && allowed.includes(value)))]
  if (!result.includes(base)) result.unshift(base)
  return { language: base, supported_languages: result }
}
function translations(input: unknown, supported: string[]) {
  const output: Record<string, { name?: string; description?: string }> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output
  for (const lang of supported) {
    const value = (input as Record<string, unknown>)[lang]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const item = value as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    if (name || description) output[lang] = { ...(name ? { name } : {}), ...(description ? { description } : {}) }
  }
  return output
}
export function menuPatch(input: unknown, current: Menu): Record<string, unknown> {
  const body = object(input), patch: Record<string, unknown> = {}
  for (const key of ['name', 'language', 'supported_languages', 'translations', 'purpose', 'description', 'is_active', 'is_default', 'is_private', 'price_multiplier', 'position']) {
    if (Object.hasOwn(body, key)) patch[key] = body[key]
  }
  if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 500)) throw new AdminMenuError(400, 'Name is required')
  if ('purpose' in patch && (typeof patch.purpose !== 'string' || patch.purpose.length > 100)) throw new AdminMenuError(400, 'Invalid menu')
  if ('description' in patch && patch.description !== null && (typeof patch.description !== 'string' || patch.description.length > 10000)) throw new AdminMenuError(400, 'Invalid menu')
  for (const key of ['is_active', 'is_default', 'is_private']) if (key in patch && typeof patch[key] !== 'boolean') throw new AdminMenuError(400, 'Invalid menu')
  if ('price_multiplier' in patch && (typeof patch.price_multiplier !== 'number' || !Number.isFinite(patch.price_multiplier) || patch.price_multiplier <= 0 || patch.price_multiplier > 999.99)) throw new AdminMenuError(400, 'Invalid menu')
  if ('position' in patch && (typeof patch.position !== 'number' || !Number.isInteger(patch.position) || patch.position < -2147483648 || patch.position > 2147483647)) throw new AdminMenuError(400, 'Invalid menu')
  if ('language' in patch || 'supported_languages' in patch) Object.assign(patch, languages(patch.language, patch.supported_languages))
  if ('translations' in patch) patch.translations = translations(patch.translations, (patch.supported_languages ?? current.supported_languages ?? ['en']) as string[])
  return patch
}

// Lock cascading parents AND affected leaves before the tenant check. Parent
// locks stop new FK references; leaf locks also stop tenant_id-only changes.
async function guardMenuDeletion(query: AdminMenuQuery, tenantId: string, id: string) {
  // Refuse schema drift that would add an unreviewed cascading/SET NULL path.
  // ROW EXCLUSIVE allows normal DML but prevents a concurrent ADD FOREIGN KEY
  // from changing that graph after it has been checked.
  const ar = (await query(`SELECT to_regclass('public.product_ar_models') IS NOT NULL AS ok`)).rows[0]?.ok === true
  const deletedTables = ['menus', 'categories', 'products', 'product_option_groups', 'product_options', 'product_ingredients', 'product_media', 'menu_sessions', 'menu_events', ...(ar ? ['product_ar_models'] : [])]
  await query(`LOCK TABLE ${deletedTables.map(table => `public.${table}`).join(', ')} IN ROW EXCLUSIVE MODE`)
  const reviewed = new Set([
    'categories:menu_id:menus:id:c', 'products:menu_id:menus:id:c', 'locations:menu_id:menus:id:n',
    'menu_sessions:menu_id:menus:id:c', 'menu_events:menu_id:menus:id:c',
    'products:category_id:categories:id:n', 'menu_events:category_id:categories:id:n',
    'product_option_groups:product_id:products:id:c', 'product_ingredients:product_id:products:id:c',
    'product_media:product_id:products:id:c', 'menu_events:product_id:products:id:n',
    'product_ar_models:product_id:products:id:c', 'menus:staging_of:menus:id:n',
    'product_options:group_id:product_option_groups:id:c',
    'menu_events:session_id:menu_sessions:id:c', 'orders:analytics_session_id:menu_sessions:id:n',
  ])
  const edges = await query(`SELECT cn.nspname AS schema, concat_ws(':', child.relname, ca.attname, parent.relname, pa.attname, fk.confdeltype) AS edge,
    cardinality(fk.conkey) AS columns, fk.convalidated AS validated
    FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class parent ON parent.oid=fk.confrelid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_catalog.pg_class child ON child.oid=fk.conrelid JOIN pg_catalog.pg_namespace cn ON cn.oid=child.relnamespace
    JOIN pg_catalog.pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
    JOIN pg_catalog.pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=fk.confkey[1]
    WHERE fk.contype='f' AND fk.confdeltype IN ('c','n','d') AND pn.nspname='public' AND parent.relname=ANY($1::text[]) LIMIT 101`, [deletedTables])
  if (edges.rows.length > 100 || edges.rows.some(row => row.schema !== 'public' || row.columns !== 1 || row.validated !== true || !reviewed.has(String(row.edge)))) throw new AdminMenuError(409, 'Menu has unreviewed dependent references')
  const values = [tenantId, id]
  const affected: Record<string, string[]> = {}
  for (const [table, clause, selected] of [
    ['categories', 'menu_id=$2', 'id'],
    ['products', 'menu_id=$2 OR category_id IN (SELECT id FROM public.categories WHERE menu_id=$2)', 'id, menu_id'],
    ['product_option_groups', 'product_id IN (SELECT id FROM public.products WHERE menu_id=$2)', 'id'],
    ['menu_sessions', 'menu_id=$2', 'id'],
  ]) {
    const result = await query(`SELECT ${selected} FROM public.${table} WHERE (${clause}) AND $1::uuid IS NOT NULL ORDER BY id LIMIT 5001 FOR UPDATE`, values)
    if (result.rows.length > 5000) throw new AdminMenuError(409, 'Menu exceeds safe deletion limit')
    affected[table] = result.rows.filter(row => table !== 'products' || row.menu_id === id).map(row => String(row.id))
  }
  const scope = [tenantId, id, affected.categories, affected.products, affected.product_option_groups, affected.menu_sessions]
  for (const [table, clause, selected] of [
    ['locations', 'menu_id=$2', 'id'],
    ['product_options', 'group_id=ANY($5::uuid[])', 'id'],
    ['product_ingredients', 'product_id=ANY($4::uuid[])', 'product_id, ingredient_id'],
    ['product_media', 'product_id=ANY($4::uuid[])', 'id'],
    ...(ar ? [['product_ar_models', 'product_id=ANY($4::uuid[])', 'id']] : []),
    // Its staging copies / replaced versions become ordinary hidden menus (SET NULL).
    ['menus', "to_jsonb(menus)->>'staging_of'=$2::text", 'id'],
    ['menu_events', 'menu_id=$2 OR session_id=ANY($6::uuid[]) OR product_id=ANY($4::uuid[]) OR category_id=ANY($3::uuid[])', 'id'],
    ['orders', 'analytics_session_id=ANY($6::uuid[])', 'id'],
  ]) {
    // Use every typed parameter in the CTE, even for the shorter leaf clauses.
    const result = await query(`WITH scope AS (SELECT $1::uuid AS tenant, $2::uuid AS menu, $3::uuid[] AS categories, $4::uuid[] AS products, $5::uuid[] AS groups, $6::uuid[] AS sessions)
      SELECT ${selected} FROM public.${table} WHERE (${clause}) ORDER BY ${selected} LIMIT 5001 FOR UPDATE`, scope)
    if (result.rows.length > 5000) throw new AdminMenuError(409, 'Menu exceeds safe deletion limit')
  }
  const integrity = await query(`SELECT EXISTS (
    SELECT 1 FROM public.categories WHERE menu_id=$2 AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.products WHERE (menu_id=$2 OR category_id=ANY($3::uuid[])) AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.locations WHERE menu_id=$2 AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.product_option_groups WHERE product_id=ANY($4::uuid[]) AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.product_options WHERE group_id=ANY($5::uuid[]) AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.product_ingredients WHERE product_id=ANY($4::uuid[]) AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.product_media WHERE product_id=ANY($4::uuid[]) AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.menus WHERE to_jsonb(menus)->>'staging_of'=$2::text AND tenant_id<>$1${ar ? `
    UNION ALL SELECT 1 FROM public.product_ar_models WHERE product_id=ANY($4::uuid[]) AND tenant_id<>$1` : ''}
    UNION ALL SELECT 1 FROM public.menu_sessions WHERE menu_id=$2 AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.menu_events WHERE (menu_id=$2 OR session_id=ANY($6::uuid[]) OR product_id=ANY($4::uuid[]) OR category_id=ANY($3::uuid[])) AND tenant_id<>$1
    UNION ALL SELECT 1 FROM public.orders WHERE analytics_session_id=ANY($6::uuid[]) AND tenant_id<>$1
  ) AS invalid`, scope)
  if (integrity.rows[0]?.invalid !== false) throw new AdminMenuError(409, 'Menu has inconsistent tenant references')
}

/** Caller supplies one bounded READ WRITE transaction; never call in autocommit. */
export async function mutateAdminMenu(query: AdminMenuQuery, context: AdminMenuContext, mutation: AdminMenuMutation): Promise<Menu | { ok: true }> {
  tenantScope(context)
  if (mutation.kind === 'create' && context.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-menus:${context.tenantId}`])
  const current = mutation.kind === 'create' ? null : await findAdminMenu(query, context, mutation.id, true)
  if (mutation.kind !== 'create' && !current) throw new AdminMenuError(404, 'Not found')
  if (context.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
  if (mutation.kind === 'delete') {
    if (current!.is_default) throw new AdminMenuError(400, 'Cannot delete the default menu')
    await guardMenuDeletion(query, context.tenantId, mutation.id)
    await query('DELETE FROM public.menus WHERE tenant_id=$1 AND id=$2', [context.tenantId, mutation.id])
    return { ok: true }
  }
  if (mutation.kind === 'create') {
    const body = object(mutation.body)
    const patch = menuPatch({ name: body.name, purpose: body.purpose ?? 'restaurant', description: body.description ?? null }, {} as Menu)
    const i18n = languages(body.language, body.supported_languages)
    const base = slugify(String(patch.name))
    const existing = await query('SELECT id FROM public.menus WHERE tenant_id=$1 AND slug=$2 LIMIT 1', [context.tenantId, base])
    const slug = existing.rows.length ? `${base}-${Date.now().toString(36)}` : base
    const result = await query(`INSERT INTO public.menus AS m(tenant_id,name,slug,language,supported_languages,translations,purpose,description)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${projected}`, [context.tenantId, String(patch.name).trim(), slug, i18n.language, i18n.supported_languages, JSON.stringify(translations(body.translations, i18n.supported_languages)), patch.purpose, patch.description])
    const created = dto(result.rows)[0]
    if (!created) throw new Error('Menu insert failed')
    return created
  }
  const patch = menuPatch(mutation.body, current!)
  // A staging copy reaches production only through the publish swap (menu-staging.ts).
  if ((current as Menu & { staging_of?: string | null }).staging_of && (patch.is_active === true || patch.is_default === true)) {
    throw new AdminMenuError(409, 'Publish the staging copy to make it live')
  }
  if (patch.is_default === true) await query('UPDATE public.menus SET is_default=false WHERE tenant_id=$1 AND is_default=true', [context.tenantId])
  const entries = Object.entries(patch)
  if (!entries.length) return current!
  const set = entries.map(([key], index) => `${key}=$${index + 3}`).join(', ')
  const result = await query(`UPDATE public.menus m SET ${set} WHERE m.tenant_id=$1 AND m.id=$2 RETURNING ${projected}`, [context.tenantId, mutation.id, ...entries.map(([key, value]) => key === 'translations' ? JSON.stringify(value) : value)])
  const updated = dto(result.rows)[0]
  if (!updated) throw new AdminMenuError(404, 'Not found')
  return updated
}
