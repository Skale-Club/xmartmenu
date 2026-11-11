/**
 * Menu staging on the owned PostgreSQL (docs/product/menu-staging.md).
 *
 *   create   copies a live menu with everything a guest sees (categories,
 *            dishes, options, ingredients, photos/videos, 3D models) into a
 *            hidden menu marked staging_of = live, with a preview token.
 *   publish  swaps a staging menu into production in one transaction: it takes
 *            the live menu's address (slug), default flag, visibility, position
 *            and branches; the replaced version stays as a hidden staging of
 *            the new live menu, so publishing it again is the undo.
 *   preview  the staging menu for /<slug>/preview/<token> (any visitor with the
 *            link; never listed, never indexed, no orders or analytics).
 *
 * Every write runs inside the caller's single READ WRITE transaction
 * (adminMenuTransaction), behind the same per-tenant advisory lock as the menu
 * writer, so a copy or swap never interleaves with a menu edit.
 *
 * The copy is column-generic (jsonb_populate_record of the source row with the
 * remapped keys overridden), so a column a later schema step adds to a catalog
 * table is copied too, instead of being silently dropped from the staging.
 * Storage objects are shared, not duplicated: deleting a photo or a 3D model in
 * the back office never removes the stored file (admin-product-ar.ts,
 * admin-product-detail.ts), so staging and production can point at one file.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { Menu } from '@/types/database'
import { ADMIN_MENU_PROJECTION, AdminMenuError, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/
/** Same bounds as the public projection: a menu bigger than this cannot be served anyway. */
export const STAGING_LIMITS = { categories: 1000, products: 2000, groups: 5000, options: 20000, ingredients: 20000, media: 10000, arModels: 2000 } as const

export type StagingMenu = Menu & { staging_of: string | null; preview_token: string | null; replaced_at: string | null }
export type MenuStagingMutation = { kind: 'create'; liveId: string } | { kind: 'publish'; id: string } | { kind: 'rotate-link'; id: string }

/** Admin projection with the staging fields (null before the schema step). */
export const STAGING_MENU_PROJECTION = ADMIN_MENU_PROJECTION

function scope(context: AdminMenuContext) {
  if (!UUID.test(context.tenantId) || !['superadmin', 'store-admin'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')
}
function menus(rows: Record<string, unknown>[]): StagingMenu[] {
  return rows.map(({ row }) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid menu')
    return row as StagingMenu
  })
}
export function newPreviewToken(): string {
  return randomBytes(24).toString('base64url')
}
/** A slug that fits the column and keeps the original readable: "<base>-<suffix>". */
export function suffixedSlug(base: string, suffix: string): string {
  return `${base.slice(0, Math.max(1, 180 - suffix.length - 1))}-${suffix}`
}

/** Whether the schema step ran (columns present). Writes refuse before it. */
export async function stagingSchemaReady(query: AdminMenuQuery): Promise<boolean> {
  const result = await query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='menus' AND column_name IN ('staging_of','preview_token','replaced_at')`)
  return Number(result.rows[0]?.n) === 3
}
async function requireSchema(query: AdminMenuQuery) {
  if (!await stagingSchemaReady(query)) throw new AdminMenuError(503, 'Staging is not available yet')
}
async function arTableReady(query: AdminMenuQuery): Promise<boolean> {
  const result = await query(`SELECT to_regclass('public.product_ar_models') IS NOT NULL AS ok`)
  return result.rows[0]?.ok === true
}
async function lockedMenu(query: AdminMenuQuery, tenantId: string, id: string): Promise<StagingMenu | null> {
  if (!UUID.test(id)) return null
  return menus((await query(`SELECT ${STAGING_MENU_PROJECTION} FROM public.menus m WHERE m.tenant_id=$1 AND m.id=$2 FOR UPDATE OF m`, [tenantId, id])).rows)[0] ?? null
}
async function ids(query: AdminMenuQuery, text: string, values: unknown[], limit: number, what: string): Promise<string[]> {
  const result = await query(`${text} ORDER BY id LIMIT ${limit + 1}`, values)
  if (result.rows.length > limit) throw new AdminMenuError(409, `Menu has too many ${what} to stage`)
  return result.rows.map(row => String(row.id))
}
function mapping(source: string[]) {
  return { from: source, to: source.map(() => randomUUID()) }
}

/**
 * The live menu → a hidden staging copy. One open staging per live menu: a
 * second request answers 409 with the existing one's id, so the team keeps one
 * place to work and the restaurant one link to look at.
 */
async function createStaging(query: AdminMenuQuery, context: AdminMenuContext, liveId: string): Promise<StagingMenu> {
  const live = await lockedMenu(query, context.tenantId, liveId)
  if (!live) throw new AdminMenuError(404, 'Not found')
  if (live.staging_of) throw new AdminMenuError(409, 'This menu is already a staging copy')
  const open = await query(`SELECT id FROM public.menus WHERE tenant_id=$1 AND staging_of=$2 AND replaced_at IS NULL LIMIT 1`, [context.tenantId, live.id])
  if (open.rows.length) throw new AdminMenuError(409, 'This menu already has a staging copy')

  const tenant = context.tenantId, menuId = randomUUID()
  const categories = mapping(await ids(query, 'SELECT id FROM public.categories WHERE tenant_id=$1 AND menu_id=$2', [tenant, live.id], STAGING_LIMITS.categories, 'categories'))
  const products = mapping(await ids(query, 'SELECT id FROM public.products WHERE tenant_id=$1 AND menu_id=$2', [tenant, live.id], STAGING_LIMITS.products, 'dishes'))
  const groups = mapping(await ids(query, 'SELECT id FROM public.product_option_groups WHERE tenant_id=$1 AND product_id=ANY($2::uuid[])', [tenant, products.from], STAGING_LIMITS.groups, 'option groups'))
  const options = mapping(await ids(query, 'SELECT id FROM public.product_options WHERE tenant_id=$1 AND group_id=ANY($2::uuid[])', [tenant, groups.from], STAGING_LIMITS.options, 'options'))
  for (const [table, limit] of [['product_ingredients', STAGING_LIMITS.ingredients], ['product_media', STAGING_LIMITS.media]] as const) {
    const count = await query(`SELECT count(*)::int AS n FROM public.${table} WHERE tenant_id=$1 AND product_id=ANY($2::uuid[])`, [tenant, products.from])
    if (Number(count.rows[0]?.n) > limit) throw new AdminMenuError(409, 'Menu has too many dish details to stage')
  }

  const slug = suffixedSlug(live.slug, `staging-${Date.now().toString(36)}`)
  const inserted = await query(`INSERT INTO public.menus AS m
    SELECT (jsonb_populate_record(NULL::public.menus, to_jsonb(src) || jsonb_build_object(
      'id', $3::uuid, 'slug', $4::text, 'is_active', false, 'is_default', false,
      'staging_of', src.id, 'preview_token', $5::text, 'replaced_at', NULL, 'created_at', now()))).*
    FROM public.menus src WHERE src.tenant_id=$1 AND src.id=$2
    RETURNING ${STAGING_MENU_PROJECTION}`, [tenant, live.id, menuId, slug, newPreviewToken()])
  const staging = menus(inserted.rows)[0]
  if (!staging) throw new Error('Staging insert failed')

  // Categories, then dishes (category and upsell ids remapped inside the copy;
  // an upsell pointing outside this menu keeps its id, as the live one did).
  await query(`INSERT INTO public.categories
    SELECT (jsonb_populate_record(NULL::public.categories, to_jsonb(c) || jsonb_build_object('id', map.new_id, 'menu_id', $3::uuid, 'created_at', now()))).*
    FROM public.categories c JOIN unnest($4::uuid[], $5::uuid[]) AS map(old_id, new_id) ON map.old_id=c.id
    WHERE c.tenant_id=$1 AND c.menu_id=$2`, [tenant, live.id, menuId, categories.from, categories.to])
  await query(`INSERT INTO public.products
    SELECT (jsonb_populate_record(NULL::public.products, to_jsonb(p) || jsonb_build_object(
      'id', map.new_id, 'menu_id', $3::uuid, 'created_at', now(), 'updated_at', now(),
      'category_id', (SELECT cm.new_id FROM unnest($6::uuid[], $7::uuid[]) AS cm(old_id, new_id) WHERE cm.old_id=p.category_id),
      'upsell_product_ids', to_jsonb(ARRAY(
        SELECT COALESCE(um.new_id, u.id) FROM unnest(p.upsell_product_ids) WITH ORDINALITY AS u(id, n)
        LEFT JOIN unnest($4::uuid[], $5::uuid[]) AS um(old_id, new_id) ON um.old_id=u.id ORDER BY u.n))))).*
    FROM public.products p JOIN unnest($4::uuid[], $5::uuid[]) AS map(old_id, new_id) ON map.old_id=p.id
    WHERE p.tenant_id=$1 AND p.menu_id=$2`, [tenant, live.id, menuId, products.from, products.to, categories.from, categories.to])
  await query(`INSERT INTO public.product_option_groups
    SELECT (jsonb_populate_record(NULL::public.product_option_groups, to_jsonb(g) || jsonb_build_object('id', gm.new_id, 'product_id', pm.new_id, 'created_at', now(), 'updated_at', now()))).*
    FROM public.product_option_groups g JOIN unnest($2::uuid[], $3::uuid[]) AS gm(old_id, new_id) ON gm.old_id=g.id
    JOIN unnest($4::uuid[], $5::uuid[]) AS pm(old_id, new_id) ON pm.old_id=g.product_id
    WHERE g.tenant_id=$1`, [tenant, groups.from, groups.to, products.from, products.to])
  await query(`INSERT INTO public.product_options
    SELECT (jsonb_populate_record(NULL::public.product_options, to_jsonb(o) || jsonb_build_object('id', om.new_id, 'group_id', gm.new_id, 'created_at', now(), 'updated_at', now()))).*
    FROM public.product_options o JOIN unnest($2::uuid[], $3::uuid[]) AS om(old_id, new_id) ON om.old_id=o.id
    JOIN unnest($4::uuid[], $5::uuid[]) AS gm(old_id, new_id) ON gm.old_id=o.group_id
    WHERE o.tenant_id=$1`, [tenant, options.from, options.to, groups.from, groups.to])
  // Rows keyed by the dish only: a fresh id where the table has one (ignored where it has none).
  const perDish = ['product_ingredients', 'product_media', ...(await arTableReady(query) ? ['product_ar_models'] : [])]
  for (const table of perDish) {
    await query(`INSERT INTO public.${table}
      SELECT (jsonb_populate_record(NULL::public.${table}, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'product_id', pm.new_id, 'created_at', now(), 'updated_at', now()))).*
      FROM public.${table} x JOIN unnest($2::uuid[], $3::uuid[]) AS pm(old_id, new_id) ON pm.old_id=x.product_id
      WHERE x.tenant_id=$1`, [tenant, products.from, products.to])
  }
  return staging
}

/**
 * Staging (or a replaced version) → production. The live menu's public
 * identity moves to the candidate; the content stays where it was edited.
 * Guests holding a cart of the replaced version get "no longer available"
 * at checkout (orders refuse dishes of a hidden menu) and reload the menu.
 */
async function publishStaging(query: AdminMenuQuery, context: AdminMenuContext, id: string): Promise<{ live: StagingMenu; previous: StagingMenu }> {
  const candidate = await lockedMenu(query, context.tenantId, id)
  if (!candidate) throw new AdminMenuError(404, 'Not found')
  if (!candidate.staging_of) throw new AdminMenuError(409, 'Only a staging copy can be published')
  const live = await lockedMenu(query, context.tenantId, candidate.staging_of)
  if (!live) throw new AdminMenuError(409, 'The live menu of this staging no longer exists')
  if (live.staging_of) throw new AdminMenuError(409, 'The live menu of this staging is itself a staging copy')

  const tenant = context.tenantId
  const parkedSlug = suffixedSlug(live.slug, `v${Date.now().toString(36)}`)
  // Free the address and the default first: (tenant_id, slug) is unique and the
  // hidden/default CHECK applies to each row as it is written.
  // The replaced version gets a preview link of its own (if it had none), so it
  // can be looked at before an undo.
  const previous = menus((await query(`UPDATE public.menus m SET slug=$3, is_active=false, is_default=false, staging_of=$4, replaced_at=now(),
    preview_token=COALESCE(m.preview_token, $5)
    WHERE m.tenant_id=$1 AND m.id=$2 RETURNING ${STAGING_MENU_PROJECTION}`, [tenant, live.id, parkedSlug, candidate.id, newPreviewToken()])).rows)[0]
  const promoted = menus((await query(`UPDATE public.menus m SET slug=$3, is_active=$4, is_default=$5, position=$6, staging_of=NULL, replaced_at=NULL
    WHERE m.tenant_id=$1 AND m.id=$2 RETURNING ${STAGING_MENU_PROJECTION}`, [tenant, candidate.id, live.slug, live.is_active, live.is_default, live.position])).rows)[0]
  if (!previous || !promoted) throw new Error('Staging publish failed')
  // Older versions and any other copy now stage the new live menu.
  await query('UPDATE public.menus SET staging_of=$3 WHERE tenant_id=$1 AND staging_of=$2', [tenant, live.id, candidate.id])
  // Branches showing the live menu keep showing it.
  await query('UPDATE public.locations SET menu_id=$3 WHERE tenant_id=$1 AND menu_id=$2', [tenant, live.id, candidate.id])
  return { live: promoted, previous }
}

async function rotateLink(query: AdminMenuQuery, context: AdminMenuContext, id: string): Promise<StagingMenu> {
  const menu = await lockedMenu(query, context.tenantId, id)
  if (!menu) throw new AdminMenuError(404, 'Not found')
  if (!menu.staging_of) throw new AdminMenuError(409, 'Only a staging copy has a preview link')
  const updated = menus((await query(`UPDATE public.menus m SET preview_token=$3 WHERE m.tenant_id=$1 AND m.id=$2 RETURNING ${STAGING_MENU_PROJECTION}`,
    [context.tenantId, id, newPreviewToken()])).rows)[0]
  if (!updated) throw new AdminMenuError(404, 'Not found')
  return updated
}

/** Caller supplies one bounded READ WRITE transaction; never call in autocommit. */
export async function mutateMenuStaging(query: AdminMenuQuery, context: AdminMenuContext, mutation: MenuStagingMutation) {
  scope(context)
  await requireSchema(query)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-menus:${context.tenantId}`])
  if (mutation.kind === 'create') return createStaging(query, context, mutation.liveId)
  if (mutation.kind === 'publish') return publishStaging(query, context, mutation.id)
  return rotateLink(query, context, mutation.id)
}

/** The staging menu a preview link opens, or null. Tenant first, so the token is matched among one restaurant's menus only. */
export async function findPreviewMenuId(query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>, tenantId: string, token: string): Promise<string | null> {
  if (!UUID.test(tenantId) || !TOKEN.test(token)) return null
  const result = await query(`SELECT m.id FROM public.menus m WHERE m.tenant_id=$1 AND m.is_active=false
    AND to_jsonb(m)->>'staging_of' IS NOT NULL AND to_jsonb(m)->>'preview_token'=$2 LIMIT 2`, [tenantId, token])
  return result.rows.length === 1 ? String(result.rows[0].id) : null
}
