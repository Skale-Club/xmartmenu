import type { Ingredient, ProductIngredient, ProductMedia, ProductOption, ProductOptionGroup, Menu } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { activeAdminMenu, AdminMenuError, readAdminMenus, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'
import { findAdminProduct, guardProductDeletion } from './admin-products'
import { PUBLIC_MENU_COLUMNS } from './public-menu'
import { planCeiling } from '../service-modes'
import { sanitizeTranslations } from '../menu-translations'
import { mutateArModel } from './admin-product-ar'

type Entity = 'groups' | 'options' | 'ingredients' | 'media' | 'translations' | 'ar'
type Action = 'list' | 'create' | 'patch' | 'delete' | 'reorder'
export type DetailOperation = { entity: Entity; action: Action; id?: unknown; groupId?: unknown; ingredientId?: unknown; values?: unknown; firstId?: unknown; secondId?: unknown }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const bad = (message = 'Invalid product configuration') => new AdminMenuError(400, message)
function identity(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new AdminMenuError(404, 'Product configuration not found')
  return value.toLowerCase()
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 64000) throw bad()
  return value as Record<string, unknown>
}
function fields(value: unknown, allowed: readonly string[]) {
  const body = object(value)
  if (Object.keys(body).some(key => !allowed.includes(key))) throw bad()
  return { ...body }
}
export function detailOperation(value: unknown): DetailOperation {
  const body = fields(value, ['entity', 'action', 'id', 'groupId', 'ingredientId', 'values', 'firstId', 'secondId'])
  if (typeof body.entity !== 'string' || !['groups', 'options', 'ingredients', 'media', 'translations', 'ar'].includes(body.entity)
    || typeof body.action !== 'string' || !['list', 'create', 'patch', 'delete', 'reorder'].includes(body.action)
    || (body.action === 'list' && body.entity !== 'media' && body.entity !== 'ar')
    || (body.entity === 'ar' && !['list', 'patch', 'delete'].includes(body.action)) || (body.entity === 'ingredients' && body.action === 'reorder')
    || (body.entity === 'media' && body.action === 'patch') || (body.entity === 'translations' && body.action !== 'patch')) throw bad()
  return body as DetailOperation
}
function scope(context: AdminMenuContext, write = false) {
  if (!uuid.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)
    || (write && context.role === 'store-staff')) throw new AdminMenuError(403, 'Forbidden')
}
function projection(alias: string, columns: string) {
  return `to_jsonb((SELECT projected FROM (SELECT ${columns.split(' ').map(column => `${alias}.${column}`).join(',')}) projected)) AS row`
}
function records<T>(result: { rows: Record<string, unknown>[] }, maximum = 5000): T[] {
  if (result.rows.length > maximum) throw new AdminMenuError(409, 'Product configuration exceeds the supported limit')
  return result.rows.map(({ row }) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid product configuration result')
    return row as T
  })
}
function money(value: unknown, signed = false, nullable = false) {
  if (nullable && value === null) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value > 99999999.99 || value < (signed ? -99999999.99 : 0)) throw bad('Invalid option price')
}
function name(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw bad('Name is required')
  return value.trim()
}
export function groupFields(value: unknown, creating: boolean) {
  const body = fields(value, ['name', 'type', 'required', 'min_selections', 'max_selections'])
  if (creating || 'name' in body) body.name = name(body.name)
  if (creating && !('type' in body)) body.type = 'single'
  if ('type' in body && (typeof body.type !== 'string' || !['single', 'multiple', 'half_and_half'].includes(body.type))) throw bad('Invalid option group type')
  if (creating) {
    if (!('required' in body)) body.required = false
    if (!('min_selections' in body)) body.min_selections = 0
    if (!('max_selections' in body)) body.max_selections = null
  }
  if ('required' in body && typeof body.required !== 'boolean') throw bad()
  for (const key of ['min_selections', 'max_selections']) {
    if (!(key in body) || (key === 'max_selections' && body[key] === null)) continue
    if (typeof body[key] !== 'number' || !Number.isInteger(body[key]) || body[key] < (key === 'max_selections' ? 1 : 0) || body[key] > 2147483647) throw bad()
  }
  // Preserve the existing independent min/max semantics; no pricing-policy rewrite.
  return body
}
export function optionFields(value: unknown, creating: boolean) {
  const body = fields(value, ['name', 'base_price', 'price_modifier', 'is_available'])
  if (creating || 'name' in body) body.name = name(body.name)
  if (creating) {
    if (!('base_price' in body)) body.base_price = null
    if (!('price_modifier' in body)) body.price_modifier = 0
    if (!('is_available' in body)) body.is_available = true
  }
  if ('base_price' in body) money(body.base_price, false, true)
  if ('price_modifier' in body) money(body.price_modifier, true)
  if ('is_available' in body && typeof body.is_available !== 'boolean') throw bad()
  return body
}
export async function readProductGroups(query: AdminMenuQuery, context: AdminMenuContext, productId: string): Promise<GroupWithOptions[]> {
  const groups = records<ProductOptionGroup>(await query(`SELECT ${projection('g', PUBLIC_MENU_COLUMNS.group)} FROM public.product_option_groups g
    WHERE g.tenant_id=$1 AND g.product_id=$2 ORDER BY g.position,g.id LIMIT 1001`, [context.tenantId, productId]), 1000)
  const options = records<ProductOption>(await query(`SELECT ${projection('o', PUBLIC_MENU_COLUMNS.option)} FROM public.product_options o
    JOIN public.product_option_groups g ON g.id=o.group_id AND g.tenant_id=o.tenant_id
    WHERE o.tenant_id=$1 AND g.product_id=$2 ORDER BY o.position,o.id LIMIT 5001`, [context.tenantId, productId]))
  return groups.map(group => ({ ...group, options: options.filter(option => option.group_id === group.id) }))
}
async function productIngredients(query: AdminMenuQuery, context: AdminMenuContext, productId: string) {
  return records<ProductIngredient>(await query(`SELECT ${projection('pi', PUBLIC_MENU_COLUMNS.productIngredient)} FROM public.product_ingredients pi
    JOIN public.ingredients i ON i.id=pi.ingredient_id AND i.tenant_id=pi.tenant_id
    WHERE pi.tenant_id=$1 AND pi.product_id=$2 ORDER BY pi.position,pi.ingredient_id LIMIT 5001`, [context.tenantId, productId]))
}
async function productMedia(query: AdminMenuQuery, context: AdminMenuContext, productId: string) {
  return records<ProductMedia>(await query(`SELECT ${projection('m', PUBLIC_MENU_COLUMNS.media)} FROM public.product_media m
    WHERE m.tenant_id=$1 AND m.product_id=$2 ORDER BY m.display_order,m.id LIMIT 1001`, [context.tenantId, productId]), 1000)
}
export async function readProductDetailPage(query: AdminMenuQuery, context: AdminMenuContext, productId: string, selectedMenuId?: string) {
  scope(context)
  const product = await findAdminProduct(query, context, productId)
  const menus = await readAdminMenus(query, context)
  const menu: Menu | null = menus.find(row => row.id === product.menu_id) ?? activeAdminMenu(menus, selectedMenuId)
  const settings = (await query('SELECT currency,ingredient_customization_enabled FROM public.tenant_settings WHERE tenant_id=$1', [context.tenantId])).rows[0]
  const subscriptions = await query(`SELECT s.status,p.features FROM public.tenant_subscriptions s
    LEFT JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2`, [context.tenantId])
  if (subscriptions.rows.length > 1) throw new AdminMenuError(409, 'Ambiguous tenant subscription')
  const subscription = subscriptions.rows[0]
  const features = subscription && ['active', 'trial'].includes(String(subscription.status)) && Array.isArray(subscription.features)
    ? subscription.features.filter((value): value is string => typeof value === 'string') : []
  const ingredients = records<Ingredient>(await query(`SELECT ${projection('i', PUBLIC_MENU_COLUMNS.ingredient)} FROM public.ingredients i
    WHERE i.tenant_id=$1 ORDER BY i.position,i.id LIMIT 1001`, [context.tenantId]), 1000)
  const candidates = await query(`SELECT p.id,p.name,c.name AS category_name FROM public.products p
    LEFT JOIN public.categories c ON c.id=p.category_id AND c.tenant_id=p.tenant_id AND c.menu_id IS NOT DISTINCT FROM p.menu_id
    WHERE p.tenant_id=$1 AND p.id<>$2 AND ($3::uuid IS NULL OR p.menu_id=$3) ORDER BY p.position,p.id LIMIT 2001`, [context.tenantId, product.id, product.menu_id])
  if (candidates.rows.length > 2000) throw new AdminMenuError(409, 'Product catalog exceeds the supported limit')
  return { product, menu, plan: planCeiling(features), groups: await readProductGroups(query, context, product.id), ingredients,
    productIngredients: await productIngredients(query, context, product.id), settings: {
      currency: typeof settings?.currency === 'string' ? settings.currency : 'USD',
      ingredient_customization_enabled: settings?.ingredient_customization_enabled === true,
    }, upsellCandidates: candidates.rows as Array<{ id: string; name: string; category_name: string | null }> }
}
async function group(query: AdminMenuQuery, context: AdminMenuContext, productId: string, value: unknown) {
  const id = identity(value)
  const current = records<ProductOptionGroup>(await query(`SELECT ${projection('g', PUBLIC_MENU_COLUMNS.group)} FROM public.product_option_groups g
    WHERE g.tenant_id=$1 AND g.product_id=$2 AND g.id=$3 FOR UPDATE OF g`, [context.tenantId, productId, id]))[0]
  if (!current) throw new AdminMenuError(404, 'Option group not found')
  return current
}
async function option(query: AdminMenuQuery, context: AdminMenuContext, productId: string, value: unknown) {
  const current = records<ProductOption>(await query(`SELECT ${projection('o', PUBLIC_MENU_COLUMNS.option)} FROM public.product_options o
    JOIN public.product_option_groups g ON g.id=o.group_id AND g.tenant_id=o.tenant_id
    WHERE o.tenant_id=$1 AND g.product_id=$2 AND o.id=$3 FOR UPDATE OF o,g`, [context.tenantId, productId, identity(value)]))[0]
  if (!current) throw new AdminMenuError(404, 'Option not found')
  return current
}
async function nextPosition(query: AdminMenuQuery, context: AdminMenuContext, table: string, parentColumn: string, parent: string, column = 'position') {
  // All identifiers come only from the fixed call sites below.
  const row = (await query(`SELECT coalesce(max(${column})::bigint,-1)+1 AS next FROM public.${table} WHERE tenant_id=$1 AND ${parentColumn}=$2`, [context.tenantId, parent])).rows[0]
  const next = Number(row?.next)
  if (!Number.isInteger(next) || next < 0 || next > 2147483647) throw new AdminMenuError(409, 'Product configuration position is unavailable')
  return next
}
async function patchRow(query: AdminMenuQuery, context: AdminMenuContext, table: string, id: string, patch: Record<string, unknown>) {
  const entries = Object.entries(patch)
  if (!entries.length) return
  await query(`UPDATE public.${table} SET ${entries.map(([key], index) => `${key}=$${index + 3}`).join(',')},updated_at=now() WHERE tenant_id=$1 AND id=$2`, [context.tenantId, id, ...entries.map(([, value]) => value)])
}
async function noCascade(query: AdminMenuQuery, table: string) {
  await query(`LOCK TABLE public.${table} IN ROW EXCLUSIVE MODE`)
  const result = await query(`SELECT EXISTS(SELECT FROM pg_constraint WHERE contype='f' AND confrelid=$1::regclass AND confdeltype IN ('c','n','d')) AS dependent`, [`public.${table}`])
  if (result.rows[0]?.dependent !== false) throw new AdminMenuError(409, 'Product configuration has unreviewed dependent references')
}
async function reorder(query: AdminMenuQuery, context: AdminMenuContext, table: string, parentColumn: string, parent: string, operation: DetailOperation, column = 'position') {
  const ids = [identity(operation.firstId), identity(operation.secondId)].sort()
  if (ids[0] === ids[1]) throw bad('Choose two different entries')
  const result = await query(`SELECT id,${column} AS position FROM public.${table} WHERE tenant_id=$1 AND ${parentColumn}=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE`, [context.tenantId, parent, ids])
  if (result.rows.length !== 2) throw new AdminMenuError(404, 'Product configuration not found')
  const [first, second] = result.rows
  const updated = await query(`UPDATE public.${table} SET ${column}=CASE id WHEN $4::uuid THEN $5::int ELSE $6::int END
    WHERE tenant_id=$1 AND ${parentColumn}=$2 AND id=ANY($3::uuid[]) RETURNING id`, [context.tenantId, parent, ids, first.id, second.position, first.position])
  if (updated.rows.length !== 2) throw new Error('Product configuration reorder failed')
}

/** All writes execute inside the caller's bounded transaction and tenant lock. */
export async function mutateProductDetail(query: AdminMenuQuery, context: AdminMenuContext, productId: string, operation: DetailOperation) {
  scope(context, operation.action !== 'list')
  if (operation.action !== 'list') await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-admin-menus:${context.tenantId}`])
  const product = await findAdminProduct(query, context, productId, operation.action !== 'list')
  if (operation.entity === 'translations') {
    const values = fields(operation.values, ['product', 'groups', 'options'])
    const groupUpdates = object(values.groups), optionUpdates = object(values.options)
    if (Object.keys(groupUpdates).length > 1000 || Object.keys(optionUpdates).length > 5000) throw bad()
    const groups = await readProductGroups(query, context, product.id)
    const groupIds = new Set(groups.map(row => row.id)), optionIds = new Set(groups.flatMap(row => row.options.map(option => option.id)))
    if (Object.keys(groupUpdates).some(id => !groupIds.has(identity(id))) || Object.keys(optionUpdates).some(id => !optionIds.has(identity(id)))) throw new AdminMenuError(404, 'Product configuration not found')
    // Lock every submitted parent before writing. A later failure rolls back all texts.
    for (const id of Object.keys(groupUpdates).sort()) await group(query, context, product.id, id)
    for (const id of Object.keys(optionUpdates).sort()) await option(query, context, product.id, id)
    const translatedProduct = sanitizeTranslations(values.product)
    await patchRow(query, context, 'products', product.id, { translations: translatedProduct })
    for (const [id, texts] of Object.entries(groupUpdates)) await patchRow(query, context, 'product_option_groups', id, { translations: sanitizeTranslations(texts, ['name']) })
    for (const [id, texts] of Object.entries(optionUpdates)) await patchRow(query, context, 'product_options', id, { translations: sanitizeTranslations(texts, ['name']) })
    return { product: translatedProduct, groups: await readProductGroups(query, context, product.id) }
  }
  if (operation.entity === 'groups') {
    if (operation.action === 'reorder') await reorder(query, context, 'product_option_groups', 'product_id', product.id, operation)
    else if (operation.action === 'create') {
      const values = groupFields(operation.values, true), entries = Object.entries(values)
      const position = await nextPosition(query, context, 'product_option_groups', 'product_id', product.id)
      await query(`INSERT INTO public.product_option_groups(tenant_id,product_id,position,price_rule,${entries.map(([key]) => key).join(',')})
        VALUES($1,$2,$3,'max',${entries.map((_, index) => `$${index + 4}`).join(',')})`, [context.tenantId, product.id, position, ...entries.map(([, value]) => value)])
    } else {
      const current = await group(query, context, product.id, operation.id)
      if (operation.action === 'delete') {
        await guardProductDeletion(query, context, product.id)
        await query('DELETE FROM public.product_option_groups WHERE tenant_id=$1 AND product_id=$2 AND id=$3', [context.tenantId, product.id, current.id])
      } else if (operation.action === 'patch') await patchRow(query, context, 'product_option_groups', current.id, groupFields(operation.values, false))
      else throw bad()
    }
    return readProductGroups(query, context, product.id)
  }
  if (operation.entity === 'options') {
    if (operation.action === 'create') {
      const parent = await group(query, context, product.id, operation.groupId), values = optionFields(operation.values, true), entries = Object.entries(values)
      const position = await nextPosition(query, context, 'product_options', 'group_id', parent.id)
      await query(`INSERT INTO public.product_options(tenant_id,group_id,position,${entries.map(([key]) => key).join(',')})
        VALUES($1,$2,$3,${entries.map((_, index) => `$${index + 4}`).join(',')})`, [context.tenantId, parent.id, position, ...entries.map(([, value]) => value)])
    } else if (operation.action === 'reorder') {
      const parent = await group(query, context, product.id, operation.groupId)
      await reorder(query, context, 'product_options', 'group_id', parent.id, operation)
    } else {
      const current = await option(query, context, product.id, operation.id)
      if (operation.action === 'delete') {
        await noCascade(query, 'product_options')
        await query('DELETE FROM public.product_options WHERE tenant_id=$1 AND group_id=$2 AND id=$3', [context.tenantId, current.group_id, current.id])
      } else if (operation.action === 'patch') await patchRow(query, context, 'product_options', current.id, optionFields(operation.values, false))
      else throw bad()
    }
    return readProductGroups(query, context, product.id)
  }
  if (operation.entity === 'ingredients') return mutateIngredients(query, context, product.id, operation)
  if (operation.entity === 'media') return mutateMedia(query, context, product.id, operation)
  if (operation.entity === 'ar') return mutateArModel(query, context, product.id, operation.action, operation.values)
  throw bad()
}

export function ingredientAssociationFields(value: unknown, creating: boolean) {
  const body = fields(value, ['is_default', 'extra_price_override', 'add_price_override'])
  if (creating) {
    if (!('is_default' in body)) body.is_default = false
    if (!('extra_price_override' in body)) body.extra_price_override = null
    if (!('add_price_override' in body)) body.add_price_override = null
  }
  if ('is_default' in body && typeof body.is_default !== 'boolean') throw bad()
  for (const key of ['extra_price_override', 'add_price_override']) if (key in body) money(body[key], false, true)
  return body
}
async function mutateIngredients(query: AdminMenuQuery, context: AdminMenuContext, productId: string, operation: DetailOperation) {
  const ingredientId = identity(operation.ingredientId)
  const parent = await query('SELECT id FROM public.ingredients WHERE tenant_id=$1 AND id=$2 FOR SHARE', [context.tenantId, ingredientId])
  if (parent.rows.length !== 1) throw new AdminMenuError(404, 'Ingredient not found')
  const existing = await query('SELECT tenant_id FROM public.product_ingredients WHERE product_id=$1 AND ingredient_id=$2 FOR UPDATE', [productId, ingredientId])
  if (existing.rows.some(row => row.tenant_id !== context.tenantId)) throw new AdminMenuError(409, 'Ingredient association has inconsistent tenant references')
  if (operation.action === 'create') {
    const values = ingredientAssociationFields(operation.values ?? {}, true)
    if (!existing.rows.length) {
      const position = await nextPosition(query, context, 'product_ingredients', 'product_id', productId)
      await query(`INSERT INTO public.product_ingredients(tenant_id,product_id,ingredient_id,is_default,extra_price_override,add_price_override,position)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [context.tenantId, productId, ingredientId, values.is_default, values.extra_price_override, values.add_price_override, position])
    }
  } else {
    if (existing.rows.length !== 1) throw new AdminMenuError(404, 'Ingredient association not found')
    if (operation.action === 'delete') {
      await noCascade(query, 'product_ingredients')
      await query('DELETE FROM public.product_ingredients WHERE tenant_id=$1 AND product_id=$2 AND ingredient_id=$3', [context.tenantId, productId, ingredientId])
    } else if (operation.action === 'patch') {
      const entries = Object.entries(ingredientAssociationFields(operation.values, false))
      if (entries.length) await query(`UPDATE public.product_ingredients SET ${entries.map(([key], index) => `${key}=$${index + 4}`).join(',')}
        WHERE tenant_id=$1 AND product_id=$2 AND ingredient_id=$3`, [context.tenantId, productId, ingredientId, ...entries.map(([, value]) => value)])
    } else throw bad()
  }
  return productIngredients(query, context, productId)
}
function mediaFields(value: unknown, context: AdminMenuContext) {
  const body = fields(value, ['type', 'url', 'storage_path'])
  if (typeof body.type !== 'string' || !['image', 'video'].includes(body.type) || typeof body.url !== 'string' || body.url.length > 2048) throw bad('Invalid media')
  try {
    const target = new URL(body.url)
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw bad('Invalid media URL')
  } catch { throw bad('Invalid media URL') }
  if ('storage_path' in body && body.storage_path !== null && (typeof body.storage_path !== 'string'
    || body.storage_path.length > 1024 || !body.storage_path.startsWith(`${context.tenantId}/`)
    || body.storage_path.includes('\0') || body.storage_path.split('/').includes('..'))) throw bad('Invalid media path')
  return { type: body.type as 'image' | 'video', url: body.url, storage_path: body.storage_path ?? null }
}
async function syncPrimaryImage(query: AdminMenuQuery, context: AdminMenuContext, productId: string, clearWhenNone = false) {
  const image = (await query("SELECT url FROM public.product_media WHERE tenant_id=$1 AND product_id=$2 AND type='image' ORDER BY display_order,id LIMIT 1", [context.tenantId, productId])).rows[0]
  if (image || clearWhenNone) await query('UPDATE public.products SET image_url=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2', [context.tenantId, productId, image?.url ?? null])
}
async function mutateMedia(query: AdminMenuQuery, context: AdminMenuContext, productId: string, operation: DetailOperation) {
  if (operation.action === 'list') return productMedia(query, context, productId)
  if (operation.action === 'create') {
    if (!Array.isArray(operation.values) || operation.values.length < 1 || operation.values.length > 8) throw bad('Invalid media batch')
    const items = operation.values.map(value => mediaFields(value, context))
    const counts = (await query("SELECT count(*)::int AS total,count(*) FILTER(WHERE type='image')::int AS images FROM public.product_media WHERE tenant_id=$1 AND product_id=$2", [context.tenantId, productId])).rows[0]
    if (!counts || Number(counts.total) + items.length > 1000) throw new AdminMenuError(409, 'Product media exceeds the supported limit')
    if (Number(counts.images) + items.filter(item => item.type === 'image').length > 8) throw bad('A product supports up to eight images')
    const position = await nextPosition(query, context, 'product_media', 'product_id', productId, 'display_order')
    if (position + items.length - 1 > 2147483647) throw new AdminMenuError(409, 'Media position is unavailable')
    for (const [index, item] of items.entries()) await query(`INSERT INTO public.product_media(tenant_id,product_id,type,url,storage_path,display_order)
      VALUES($1,$2,$3,$4,$5,$6)`, [context.tenantId, productId, item.type, item.url, item.storage_path, position + index])
    if (items.some(item => item.type === 'image')) await syncPrimaryImage(query, context, productId)
  } else if (operation.action === 'delete') {
    const id = identity(operation.id)
    const current = (await query('SELECT type FROM public.product_media WHERE tenant_id=$1 AND product_id=$2 AND id=$3 FOR UPDATE', [context.tenantId, productId, id])).rows[0]
    if (!current) throw new AdminMenuError(404, 'Media not found')
    await noCascade(query, 'product_media')
    await query('DELETE FROM public.product_media WHERE tenant_id=$1 AND product_id=$2 AND id=$3', [context.tenantId, productId, id])
    await syncPrimaryImage(query, context, productId, current.type === 'image')
  } else if (operation.action === 'reorder') {
    await reorder(query, context, 'product_media', 'product_id', productId, operation, 'display_order')
    await syncPrimaryImage(query, context, productId)
  } else throw bad()
  return productMedia(query, context, productId)
}
