import type { CachedPublicMenu } from '../menu/public-menu-data'
import { arModelsByProductId, buildOptionGroupsByProductId, groupByProductId, pickDefaultMenu, pickSectionMenu } from '../menu/public-menu-model'
import { resolveTenantCapabilities, type ServiceSettings } from '../service-modes'
import { hasAnyChannel, resolveChatChannels } from '../chat-channels'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import type { DeliveryZone, ProductIngredientWithIngredient, ProductMedia, PublicProductArModel } from '@/types/database'

export type PublicMenuQuery = (text: string, values?: unknown[]) => Promise<{ rows: Array<{ row: unknown }> }>
type Row = Record<string, unknown>
type MenuRow = Row & { id: string; slug: string; is_default: boolean }
type LocationRow = Row & { id: string; menu_id: string | null }

// Fixed public projections. New columns and credentials never join the DTO merely
// because a restored table gained a column. No SELECT *, row_to_json(table), RPC,
// auth schema, storage client, billing provider or Google client is used here.
export const PUBLIC_MENU_COLUMNS = {
  tenant: 'id slug name plan is_active created_at updated_at custom_domain custom_domain_verified',
  settings: 'id tenant_id logo_url primary_color accent_color banner_url address phone instagram whatsapp business_hours custom_tags currency language whatsapp_orders_enabled orders_enabled direct_orders_enabled item_notes_enabled ingredient_customization_enabled amber_threshold_minutes red_threshold_minutes dine_in_enabled pickup_enabled delivery_enabled pickup_eta_minutes delivery_fee_cents tips_enabled tip_percentage_1 tip_percentage_2 tip_percentage_3 table_management_enabled analytics_enabled visual_feed_enabled menu_default_view feed_autoplay_videos upsell_enabled updated_at business_type tagline about seo_title seo_description seo_keywords seo_og_image_url seo_noindex city region postal_code country latitude longitude price_range',
  menu: 'id tenant_id name slug description language supported_languages translations purpose is_active is_default is_private price_multiplier position created_at',
  location: 'id tenant_id name slug address city phone business_hours region postal_code country latitude longitude menu_id is_active created_at updated_at',
  category: 'id tenant_id menu_id name translations course description position is_active created_at',
  product: 'id tenant_id menu_id category_id name translations description price original_price image_url image_urls is_available is_featured upsell_product_ids show_in_feed tags position created_at updated_at',
  group: 'id product_id tenant_id name type required min_selections max_selections price_rule position translations created_at updated_at',
  option: 'id group_id tenant_id name base_price price_modifier is_available position translations created_at updated_at',
  ingredient: 'id tenant_id name image_url default_extra_price default_add_price is_available position translations created_at updated_at',
  productIngredient: 'product_id ingredient_id tenant_id is_default extra_price_override add_price_override position',
  media: 'id product_id tenant_id type url storage_path display_order created_at',
  arModel: 'product_id glb_url usdz_url poster_url real_scale',
  zone: 'id tenant_id name fee_cents zipcode_prefixes is_active created_at updated_at',
} as const

function projection(alias: string, columns: string): string {
  return columns.split(' ').map(column => `${alias}.${column}`).join(', ')
}
function jsonProjection(alias: string, columns: string): string {
  return `to_jsonb((SELECT projected FROM (SELECT ${projection(alias, columns)}) projected))`
}
function publicSelect(table: string, alias: string, columns: string, scope: string, order: string, limit: number): string {
  return `SELECT ${jsonProjection(alias, columns)} AS row FROM public.${table} ${alias} ${scope} ORDER BY ${order} LIMIT ${limit + 1}`
}
async function rows<T extends Row>(query: PublicMenuQuery, text: string, values: unknown[], limit: number): Promise<T[]> {
  const result = await query(text, values)
  if (result.rows.length > limit) throw new Error('Public projection exceeded its bounded limit')
  return result.rows.map(item => {
    if (!item.row || typeof item.row !== 'object' || Array.isArray(item.row)) throw new Error('Invalid public projection')
    return item.row as T
  })
}
function one<T>(values: T[]): T | null {
  if (values.length > 1) throw new Error('Ambiguous singleton')
  return values[0] ?? null
}
function validSegment(segment: unknown): segment is string {
  return typeof segment === 'string' && segment.length > 0 && segment.length <= 200 && !segment.includes('\0')
}

/** All queries run inside the runtime's one read-only repeatable-read snapshot. */
export async function readOwnedPublicMenu(query: PublicMenuQuery, slug: string, menuSlug: string | undefined): Promise<CachedPublicMenu> {
  if (!validSegment(slug) || (menuSlug !== undefined && !validSegment(menuSlug))) return { kind: 'not_found' }
  try {
    const tenant = one(await rows<Row & { id: string; tenant_settings: (Row & ServiceSettings) | null }>(query,
      `SELECT ${jsonProjection('t', PUBLIC_MENU_COLUMNS.tenant)} || jsonb_build_object('tenant_settings', CASE WHEN s.id IS NULL THEN NULL ELSE ${jsonProjection('s', PUBLIC_MENU_COLUMNS.settings)} END) AS row
       FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.slug=$1 AND t.is_active=true LIMIT 2`, [slug], 1))
    if (!tenant) return { kind: 'not_found' }
    if (typeof tenant.id !== 'string') throw new Error('Invalid tenant')
    const tenantId = tenant.id
    const settings = tenant.tenant_settings
    const footer = one(await rows<Row>(query, 'SELECT jsonb_build_object(\'menu_footer_brand\', menu_footer_brand) AS row FROM public.platform_settings LIMIT 2', [], 1))
    const footerBrand = typeof footer?.menu_footer_brand === 'string' ? footer.menu_footer_brand : 'XmartMenu'
    const menus = await rows<MenuRow>(query, publicSelect('menus', 'm', PUBLIC_MENU_COLUMNS.menu,
      'WHERE m.tenant_id=$1 AND m.is_active=true', 'm.position, m.id', 100), [tenantId], 100)
    const locations = await rows<LocationRow>(query, publicSelect('locations', 'l', PUBLIC_MENU_COLUMNS.location,
      `WHERE l.tenant_id=$1 AND l.is_active=true${menuSlug === undefined ? '' : ' AND l.slug=$2'}`, 'l.created_at, l.id', 100), menuSlug === undefined ? [tenantId] : [tenantId, menuSlug], 100)
    if (menuSlug === undefined && locations.length >= 2) {
      // Match the existing branch-picker projection instead of serializing extra
      // branch metadata/columns that the picker never requested.
      return { kind: 'branches', tenant, footerBrand, locations: locations.map(({ id, name, slug, address, city, phone, business_hours }) => ({ id, name, slug, address, city, phone, business_hours })) }
    }
    const location = menuSlug === undefined ? null : one(locations)
    const menu = menuSlug === undefined ? pickDefaultMenu(menus) : pickSectionMenu(menus, menuSlug, location)
    if (menuSlug !== undefined && !location && !menu) return { kind: 'not_found' }
    const subscription = one(await rows<Row>(query,
      `SELECT jsonb_build_object('status', s.status, 'features', p.features, 'chat_addon_active', s.chat_addon_active,
       'chat_addon_override', s.chat_addon_override, 'chat_addon_available', p.chat_addon_available) AS row
       FROM public.tenant_subscriptions s LEFT JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2`, [tenantId], 1))
    const features = subscription && ['active', 'trial'].includes(String(subscription.status)) && Array.isArray(subscription.features)
      ? subscription.features.filter((value): value is string => typeof value === 'string') : null
    const capabilities = resolveTenantCapabilities(features, settings)
    const chat = one(await rows<Row>(query,
      'SELECT jsonb_build_object(\'enabled\', enabled, \'audio_enabled\', audio_enabled, \'text_enabled\', text_enabled) AS row FROM public.chat_addon_settings WHERE tenant_id=$1 LIMIT 2', [tenantId], 1))
    const chatActive = subscription?.chat_addon_override === true
      || (subscription?.chat_addon_override !== false && subscription?.chat_addon_available === true && subscription?.chat_addon_active === true)
    const channels = resolveChatChannels(chatActive && chat?.enabled === true
      ? { audio_enabled: chat.audio_enabled === true, text_enabled: chat.text_enabled === true } : null)
    const tableRows = await rows<Row & { id: string; name: string }>(query,
      'SELECT jsonb_build_object(\'id\', id, \'name\', name) AS row FROM public.restaurant_tables WHERE tenant_id=$1 AND is_active=true ORDER BY position, id LIMIT 1001', [tenantId], 1000)
    const zones = capabilities.delivery ? await rows<Row>(query, publicSelect('delivery_zones', 'z', PUBLIC_MENU_COLUMNS.zone,
      'WHERE z.tenant_id=$1 AND z.is_active=true', 'z.created_at, z.id', 1000), [tenantId], 1000) : []
    const categories = menu?.id ? await rows<Row>(query, publicSelect('categories', 'c', PUBLIC_MENU_COLUMNS.category,
      'JOIN public.menus m ON m.id=c.menu_id AND m.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND c.menu_id=$2 AND c.is_active=true AND m.is_active=true', 'c.position, c.id', 1000), [tenantId, menu.id], 1000) : []
    const products = menu?.id ? await rows<Row & { id: string }>(query, publicSelect('products', 'p', PUBLIC_MENU_COLUMNS.product,
      'JOIN public.menus m ON m.id=p.menu_id AND m.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND m.is_active=true', 'p.position, p.id', 2000), [tenantId, menu.id], 2000) : []
    let groups: GroupWithOptions[] = [], ingredients: ProductIngredientWithIngredient[] = [], media: ProductMedia[] = [], arModels: PublicProductArModel[] = []
    if (products.length && menu?.id) {
      const ids = products.map(product => product.id)
      const groupRows = await rows<Row>(query, publicSelect('product_option_groups', 'g', PUBLIC_MENU_COLUMNS.group,
        'JOIN public.products p ON p.id=g.product_id AND p.tenant_id=g.tenant_id WHERE g.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND g.product_id=ANY($3::uuid[])', 'g.position, g.id', 5000), [tenantId, menu.id, ids], 5000)
      const optionRows = await rows<Row & { group_id: string }>(query, publicSelect('product_options', 'o', PUBLIC_MENU_COLUMNS.option,
        'JOIN public.product_option_groups g ON g.id=o.group_id AND g.tenant_id=o.tenant_id JOIN public.products p ON p.id=g.product_id AND p.tenant_id=g.tenant_id WHERE o.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND o.is_available=true AND g.product_id=ANY($3::uuid[])', 'o.position, o.id', 20000), [tenantId, menu.id, ids], 20000)
      groups = groupRows.map(group => ({ ...group, options: optionRows.filter(option => option.group_id === group.id) })) as unknown as GroupWithOptions[]
      if (capabilities.ingredientCustomization) {
        ingredients = await rows<Row>(query,
          `SELECT ${jsonProjection('pi', PUBLIC_MENU_COLUMNS.productIngredient)} || jsonb_build_object('ingredient', ${jsonProjection('i', PUBLIC_MENU_COLUMNS.ingredient)}) AS row
           FROM public.product_ingredients pi JOIN public.ingredients i ON i.id=pi.ingredient_id AND i.tenant_id=pi.tenant_id
           JOIN public.products p ON p.id=pi.product_id AND p.tenant_id=pi.tenant_id
           WHERE pi.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND pi.product_id=ANY($3::uuid[]) ORDER BY pi.position, pi.product_id, pi.ingredient_id LIMIT 20001`, [tenantId, menu.id, ids], 20000) as unknown as ProductIngredientWithIngredient[]
      }
      media = await rows<Row>(query, publicSelect('product_media', 'pm', PUBLIC_MENU_COLUMNS.media,
        'JOIN public.products p ON p.id=pm.product_id AND p.tenant_id=pm.tenant_id WHERE pm.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND pm.product_id=ANY($3::uuid[])', 'pm.display_order, pm.id', 10000), [tenantId, menu.id, ids], 10000) as unknown as ProductMedia[]
      // Augmented reality. Any error aborts the whole snapshot, so the table is
      // read only once it exists and the runtime may read it: until the schema
      // step runs, menus simply have no 3D views.
      const arReadable = one(await rows<Row>(query,
        `SELECT jsonb_build_object('readable', CASE WHEN to_regclass('public.product_ar_models') IS NULL THEN false
         ELSE has_table_privilege(to_regclass('public.product_ar_models'), 'SELECT') END) AS row`, [], 1))
      if (arReadable?.readable === true) {
        arModels = await rows<Row>(query, publicSelect('product_ar_models', 'ar', PUBLIC_MENU_COLUMNS.arModel,
          'JOIN public.products p ON p.id=ar.product_id AND p.tenant_id=ar.tenant_id WHERE ar.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND ar.product_id=ANY($3::uuid[])', 'ar.product_id', 2000), [tenantId, menu.id, ids], 2000) as unknown as PublicProductArModel[]
      }
    }
    return { kind: 'menu', tenant, footerBrand, menu, location, categories, products, capabilities,
      optionGroupsByProductId: buildOptionGroupsByProductId(groups), productIngredientsByProductId: groupByProductId(ingredients),
      productMediaByProductId: groupByProductId(media), productArModelByProductId: arModelsByProductId(arModels), deliveryZones: zones as unknown as DeliveryZone[],
      chatAddonEnabled: chatActive && chat?.enabled === true && hasAnyChannel(channels), chatAddonAudioEnabled: channels.voice,
      chatAddonTextEnabled: channels.text, tables: tableRows }
  } catch { throw new Error('Public menu is unavailable') }
}

export function publicMenuSource(env: Record<string, string | undefined>): 'owned-v1' | 'legacy' {
  return env.OWNED_PUBLIC_MENU_ENABLED === 'true' ? 'owned-v1' : 'legacy'
}
