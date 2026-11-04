import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { readPublicChatAddon } from './public-chat-session'
import { effectiveMultiplier, HISTORY_LIMIT, type CatalogGroup, type CatalogIngredient, type CatalogOption, type CatalogProduct, type MenuCatalog } from '../chat-agent'
import { resolveTenantCapabilities } from '../service-modes'
import { resolveOrderingMode } from '../chat-context'
import type { ChatLocation, ChatSettings } from '../chat-prompt'
import { resolveChatChannels } from '../chat-channels'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Row = Record<string, unknown>
async function rows<T>(query: AdminMenuQuery, sql: string, values: unknown[], limit: number): Promise<T[]> {
  const result = await query(sql, values)
  if (result.rows.length > limit) throw new AdminMenuError(503, 'Chat information is unavailable')
  return result.rows as unknown as T[]
}
function one<T>(values: T[]): T | undefined {
  if (values.length > 1) throw new AdminMenuError(503, 'Chat information is unavailable')
  return values[0]
}
export class ChatLimitError extends AdminMenuError {
  constructor(public limit: number, public used: number) { super(429, 'Daily message limit reached') }
}
// Same fixed context columns requested by the legacy message route; no keys.
const SETTINGS = 'orders_enabled,direct_orders_enabled,whatsapp_orders_enabled,dine_in_enabled,pickup_enabled,pickup_eta_minutes,delivery_enabled,delivery_fee_cents,tips_enabled,currency,address,city,region,postal_code,country,phone,whatsapp,instagram,business_hours,business_type,tagline,about,price_range'
type Conversation = { id: string; tenant_id: string; phone_hash: string; status: string; message_count: number }
type ChatConfiguration = { openrouter_model: string | null; rate_limit_per_phone_per_day: number | null; text_enabled: boolean | null; audio_enabled: boolean | null; audio_provider: string | null }

async function admission(query: AdminMenuQuery, slug: string, conversationId: string, audio = false, lock = false) {
  if (!UUID.test(conversationId)) throw new AdminMenuError(400, 'Invalid conversation')
  const tenant = one(await rows<{ id: string; name: string }>(query, `SELECT id,name FROM public.tenants WHERE slug=$1 AND is_active=true LIMIT 2${lock ? ' FOR SHARE' : ''}`, [slug], 1))
  if (!tenant) throw new AdminMenuError(404, 'Tenant not found')
  const addon = await readPublicChatAddon(query, tenant.id)
  if (!addon.status.enabled) throw new AdminMenuError(403, 'Chat addon not enabled')
  // Moderation/session creation use this same phone lock before row locks.
  // Read the immutable tuple first, then lock and independently re-read it.
  let lockedHash: unknown
  if (lock) {
    const lookup = one(await rows<{ phone_hash: string }>(query, 'SELECT phone_hash FROM public.chat_conversations WHERE id=$1 AND tenant_id=$2 LIMIT 2', [conversationId, tenant.id], 1))
    if (!lookup) throw new AdminMenuError(400, 'Invalid conversation')
    lockedHash = lookup.phone_hash
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-chat-session:${tenant.id}:${lockedHash}`])
  }
  const conversation = one(await rows<Conversation>(query, `SELECT id,tenant_id,phone_hash,status,message_count FROM public.chat_conversations WHERE id=$1 AND tenant_id=$2 LIMIT 2${lock ? ' FOR UPDATE' : ''}`, [conversationId, tenant.id], 1))
  if (!conversation) throw new AdminMenuError(400, 'Invalid conversation')
  if (lock && conversation.phone_hash !== lockedHash) throw new AdminMenuError(409, 'Conversation identity changed')
  if (conversation.status === 'blocked') throw new AdminMenuError(audio ? 400 : 403, audio ? 'Invalid conversation' : 'Conversation has been blocked')
  const blocked = await rows<Row>(query, 'SELECT id FROM public.chat_blocked_phones WHERE tenant_id=$1 AND phone_hash=$2 LIMIT 2', [tenant.id, conversation.phone_hash], 1)
  if (blocked.length) throw new AdminMenuError(403, 'This number is blocked')
  const configuration = one(await rows<ChatConfiguration>(query, `SELECT openrouter_model,rate_limit_per_phone_per_day,text_enabled,audio_enabled,audio_provider FROM public.chat_addon_settings WHERE tenant_id=$1 LIMIT 2`, [tenant.id], 1))
  if (!configuration) throw new AdminMenuError(503, audio ? 'Audio not configured' : 'AI assistant not configured')
  const limit = configuration.rate_limit_per_phone_per_day ?? 30
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AdminMenuError(503, 'AI assistant not configured')
  return { tenant, conversation, configuration, limit }
}
export async function countPublicChatMessages(query: AdminMenuQuery, tenantId: string, phoneHash: string, now = new Date()) {
  const result = await query(`SELECT count(*)::int AS used FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id
    WHERE c.tenant_id=$1 AND c.phone_hash=$2 AND m.role='user' AND m.created_at>=$3`, [tenantId, phoneHash, new Date(now.getTime() - 86400000).toISOString()])
  const used = result.rows[0]?.used
  if (!Number.isInteger(used) || Number(used) < 0) throw new AdminMenuError(503, 'Chat information is unavailable')
  return Number(used)
}

/** Anonymous catalog: active/public menus only, all children tied to tenant+menu. */
export async function readPublicChatCatalog(query: AdminMenuQuery, tenantId: string, currency: string | null, requestedMenu?: string | null): Promise<MenuCatalog | null> {
  const menus = await rows<{ id: string; name: string; price_multiplier: number }>(query, `SELECT id,name,price_multiplier FROM public.menus WHERE tenant_id=$1 AND is_active=true AND is_private IS NOT TRUE ORDER BY is_default DESC,position LIMIT 101`, [tenantId], 100)
  const menu = menus.find(row => row.id === requestedMenu) ?? menus[0]
  if (!menu) return null
  const categories = await rows<MenuCatalog['categories'][number]>(query, `SELECT id,name,description FROM public.categories WHERE tenant_id=$1 AND menu_id=$2 AND is_active=true ORDER BY position LIMIT 1001`, [tenantId, menu.id], 1000)
  const products = await rows<Omit<CatalogProduct, 'groups' | 'ingredients'>>(query, `SELECT id,category_id,name,description,price,original_price,tags FROM public.products WHERE tenant_id=$1 AND menu_id=$2 AND is_available=true ORDER BY position LIMIT 2001`, [tenantId, menu.id], 2000)
  const groups = new Map<string, CatalogGroup[]>(), ingredients = new Map<string, CatalogIngredient[]>()
  if (products.length) {
    const ids = products.map(row => row.id)
    const groupRows = await rows<Omit<CatalogGroup, 'options'> & { product_id: string }>(query, `SELECT g.id,g.product_id,g.name,g.type,g.required,g.min_selections,g.max_selections FROM public.product_option_groups g
      JOIN public.products p ON p.id=g.product_id AND p.tenant_id=g.tenant_id WHERE g.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND p.id=ANY($3::uuid[]) ORDER BY g.position LIMIT 5001`, [tenantId, menu.id, ids], 5000)
    const options = await rows<CatalogOption & { group_id: string }>(query, `SELECT o.id,o.group_id,o.name,o.base_price,o.price_modifier FROM public.product_options o
      JOIN public.product_option_groups g ON g.id=o.group_id AND g.tenant_id=o.tenant_id JOIN public.products p ON p.id=g.product_id AND p.tenant_id=g.tenant_id
      WHERE o.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND p.id=ANY($3::uuid[]) AND o.is_available IS DISTINCT FROM false ORDER BY o.position LIMIT 20001`, [tenantId, menu.id, ids], 20000)
    const optionGroups = new Map<string, CatalogOption[]>()
    for (const option of options) { const list = optionGroups.get(option.group_id) ?? []; list.push({ id: option.id, name: option.name, base_price: option.base_price === null ? null : Number(option.base_price), price_modifier: Number(option.price_modifier ?? 0) }); optionGroups.set(option.group_id, list) }
    for (const group of groupRows) { const list = groups.get(group.product_id) ?? []; list.push({ id: group.id, name: group.name, type: group.type, required: !!group.required, min_selections: Number(group.min_selections ?? 0), max_selections: group.max_selections == null ? null : Number(group.max_selections), options: optionGroups.get(group.id) ?? [] }); groups.set(group.product_id, list) }
    const ingredientRows = await rows<CatalogIngredient & { product_id: string }>(query, `SELECT pi.product_id,pi.is_default,i.name FROM public.product_ingredients pi
      JOIN public.ingredients i ON i.id=pi.ingredient_id AND i.tenant_id=pi.tenant_id JOIN public.products p ON p.id=pi.product_id AND p.tenant_id=pi.tenant_id
      WHERE pi.tenant_id=$1 AND p.menu_id=$2 AND p.is_available=true AND p.id=ANY($3::uuid[]) AND i.is_available IS DISTINCT FROM false AND i.name<>'' ORDER BY pi.position LIMIT 20001`, [tenantId, menu.id, ids], 20000)
    for (const ingredient of ingredientRows) { const list = ingredients.get(ingredient.product_id) ?? []; list.push({ name: ingredient.name, is_default: !!ingredient.is_default }); ingredients.set(ingredient.product_id, list) }
  }
  return { menuName: menu.name, currency, priceMultiplier: effectiveMultiplier({ price_multiplier: Number(menu.price_multiplier) }), categories,
    products: products.map(product => ({ ...product, price: Number(product.price), original_price: product.original_price === null ? null : Number(product.original_price), tags: product.tags ?? null, groups: groups.get(product.id) ?? [], ingredients: ingredients.get(product.id) ?? [] })) }
}

export async function readPublicChatTurn(query: AdminMenuQuery, slug: string, conversationId: string, requestedMenu?: string | null, now = new Date()) {
  const admitted = await admission(query, slug, conversationId)
  const { tenant, conversation } = admitted
  const settings = one(await rows<ChatSettings>(query, `SELECT ${SETTINGS} FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 2`, [tenant.id], 1)) ?? {}
  const subscription = one(await rows<{ status: string; features: unknown }>(query, `SELECT s.status,p.features FROM public.tenant_subscriptions s JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2`, [tenant.id], 1))
  let features: string[] = []
  if (subscription && ['active', 'trial'].includes(subscription.status)) {
    if (!Array.isArray(subscription.features) || subscription.features.some(value => typeof value !== 'string')) throw new AdminMenuError(503, 'Chat information is unavailable')
    features = subscription.features
  }
  const capabilities = resolveTenantCapabilities(features, settings), settingsRow = { ...settings, direct_orders_enabled: capabilities.guestOrdering }
  const canAddToCart = resolveOrderingMode(settingsRow, capabilities) === 'cart'
  const used = await countPublicChatMessages(query, tenant.id, conversation.phone_hash, now)
  const catalog = await readPublicChatCatalog(query, tenant.id, settingsRow.currency ?? null, requestedMenu)
  const history = await rows<{ role: string; content: string }>(query, `SELECT m.role,m.content FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=$1 AND c.tenant_id=$2 ORDER BY m.created_at DESC LIMIT ${HISTORY_LIMIT}`, [conversation.id, tenant.id], HISTORY_LIMIT)
  const locations = await rows<ChatLocation>(query, `SELECT id,name,address,city,region,postal_code,country,phone,business_hours FROM public.locations WHERE tenant_id=$1 AND is_active=true ORDER BY name LIMIT 101`, [tenant.id], 100)
  const zones = capabilities.delivery ? await rows<{ name: string; fee_cents: number }>(query, `SELECT name,fee_cents FROM public.delivery_zones WHERE tenant_id=$1 AND is_active=true ORDER BY name LIMIT 1001`, [tenant.id], 1000) : []
  const connections = canAddToCart && capabilities.plan.stripe ? await rows<Row>(query, 'SELECT stripe_account_id FROM public.stripe_connections WHERE tenant_id=$1 AND is_active=true LIMIT 2', [tenant.id], 2) : []
  return { ...admitted, settingsRow, capabilities, canAddToCart, used, catalog, history, locations, zones, onlinePayment: connections.length === 1 }
}
export async function readPublicChatAudio(query: AdminMenuQuery, slug: string, conversationId: string) {
  const result = await admission(query, slug, conversationId, true)
  if (!result.configuration.audio_enabled) throw new AdminMenuError(503, 'Audio not configured')
  return result
}

/** Recheck current controls after provider work; insert both turns/counter atomically. */
export async function savePublicChatTurn(query: AdminMenuQuery, input: { slug: string; tenantId: string; conversationId: string; user: string; assistant: string; tokens: number | null; voiceVerified: boolean }, now = new Date()) {
  const current = await admission(query, input.slug, input.conversationId, false, true)
  if (current.tenant.id !== input.tenantId) throw new AdminMenuError(400, 'Invalid conversation')
  const channels = resolveChatChannels(current.configuration)
  if (!channels.text && (!channels.voice || !input.voiceVerified)) throw new AdminMenuError(403, 'This restaurant takes voice messages only')
  const used = await countPublicChatMessages(query, current.tenant.id, current.conversation.phone_hash, now)
  if (used >= current.limit) throw new ChatLimitError(current.limit, used)
  const timestamp = now.toISOString(), assistantTime = new Date(now.getTime() + 1).toISOString()
  await query(`INSERT INTO public.chat_messages(conversation_id,role,content,created_at,tokens_used) VALUES($1,'user',$2,$3,NULL),($1,'assistant',$4,$5,$6)`, [current.conversation.id, input.user, timestamp, input.assistant, assistantTime, input.tokens])
  const updated = await query(`UPDATE public.chat_conversations SET last_message_at=GREATEST(last_message_at,$3),message_count=COALESCE(message_count,0)+2 WHERE id=$1 AND tenant_id=$2 RETURNING id`, [current.conversation.id, current.tenant.id, assistantTime])
  if (updated.rows.length !== 1) throw new AdminMenuError(503, 'Conversation is unavailable')
  return { remaining_today: Math.max(0, current.limit - used - 1) }
}
