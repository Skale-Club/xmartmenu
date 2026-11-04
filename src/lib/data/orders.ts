import { randomUUID } from 'node:crypto'
import { canKitchenMove, isOrderStatus, type OrderStatus } from '../orders/status-machine'
import { resolveTenantCapabilities, type ServiceSettings } from '../service-modes'
import { resolveOptionSelection, type OptionSelectionState, type ServerOptionGroup } from '../menu/option-pricing'
import type { Order, OrderItem, UserRole } from '@/types/database'

export type OrderQuery = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
export type OrderContext = { tenantId: string; role: UserRole }
type Result<T> = { data: T; error: { code?: string } | null }
type Settings = ServiceSettings & { delivery_fee_cents?: number | null; currency?: string | null; country?: string | null;
  amber_threshold_minutes?: number | null; red_threshold_minutes?: number | null }
type Product = { id: string; tenant_id: string; name: string; price: number; is_available: boolean | null; menu_id: string;
  menus: { id: string; is_active: boolean | null; is_private: boolean | null; price_multiplier: number | null } }
export type CreatedOrder = { id: string; status: string; total: number | string; order_type: string; replayed: boolean }
export type KdsOrder = Order & { order_items: OrderItem[] }
export type KdsLocation = { id: string; name: string; slug: string }
export type KdsBootstrap = {
  orders: KdsOrder[]
  locations: KdsLocation[]
  capabilities: ReturnType<typeof resolveTenantCapabilities>
  amberThreshold: number
  redThreshold: number
  currency: string
}
export class OrderDataError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const ordersDataOwned = (env: Record<string, string | undefined> = process.env) => env.OWNED_ORDER_DATA_ENABLED === 'true'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const ORDER_RPC_BODY_SHA256 = 'b579f7885163e682b14649dca2d4fa7b7edb59a7626171d6a6b0fee082d20c75'
export type OrderPriceGroup = ServerOptionGroup & { position: number }

/** Equal positions have no legacy ordering contract. Permit only commuting selected effects. */
export function assertUnambiguousOrderOptionPricing(basePrice: number, editor: OptionSelectionState | null | undefined, groups: OrderPriceGroup[]) {
  const buckets = new Map<number, OrderPriceGroup[]>()
  for (const group of groups) {
    if (!Number.isInteger(group.position)) throw new OrderDataError(503, 'Option ordering must be verified')
    const bucket = buckets.get(group.position) ?? []
    bucket.push(group); buckets.set(group.position, bucket)
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    const resets: number[] = [], additions: number[] = [], labels = new Map<string, string>()
    for (const group of bucket) {
      const selectedSingle = editor?.singleSelections?.[group.id]
      const selectedHalf = editor?.halfSelections?.[group.id]
      const selection = {
        singleSelections: selectedSingle ? { [group.id]: selectedSingle } : {},
        halfSelections: selectedHalf ? { [group.id]: selectedHalf } : {},
        multiSelections: editor?.multiSelections?.[group.id] ? { [group.id]: editor.multiSelections[group.id] } : {},
      }
      const resolved = resolveOptionSelection(basePrice, selection, [group])
      const singleOption = group.options.find(option => option.id === selectedSingle)
      const resetsPrice = (group.type === 'single' && selectedSingle && singleOption?.base_price != null)
        || (group.type === 'half_and_half' && selectedHalf?.half1 && selectedHalf?.half2)
      if (resetsPrice) resets.push(resolved.unit)
      else additions.push(resolved.unit - basePrice)
      for (const [key, value] of Object.entries(resolved.labels)) {
        if (labels.has(key) && labels.get(key) !== value) throw new OrderDataError(503, 'Option ordering must be verified')
        labels.set(key, value)
      }
    }
    // Additions commute; two resets commute only at the same value. A reset
    // and a nonzero addition do not commute, so a UUID tie-break cannot price them.
    if (resets.some(value => !Number.isFinite(value)) || additions.some(value => !Number.isFinite(value))
      || (resets.length > 0 && (new Set(resets).size > 1 || additions.some(value => value !== 0)))) {
      throw new OrderDataError(503, 'Option ordering must be verified')
    }
  }
}
export const ORDER_COLUMNS = 'id tenant_id customer_name customer_phone customer_phone_key customer_id customer_phone_e164 customer_linked_at customer_link_method status total subtotal currency delivery_fee_cents payment_intent_id order_type delivery_address delivery_street delivery_complement delivery_zipcode delivery_city delivery_notes delivery_zone_id location_id tip_cents table_name table_id analytics_session_id notes created_at updated_at'
export const ITEM_COLUMNS = 'id order_id product_id product_name quantity unit_price selected_options notes ingredient_modifications added_via'
const SETTINGS_COLUMNS = 'orders_enabled direct_orders_enabled table_management_enabled whatsapp_orders_enabled whatsapp tips_enabled item_notes_enabled ingredient_customization_enabled dine_in_enabled pickup_enabled delivery_enabled upsell_enabled delivery_fee_cents currency country amber_threshold_minutes red_threshold_minutes'
const orderFields = new Set(('tenant_id customer_name customer_phone customer_phone_key customer_id customer_phone_e164 status total subtotal currency delivery_fee_cents order_type delivery_address delivery_street delivery_complement delivery_zipcode delivery_city delivery_notes delivery_zone_id location_id tip_cents table_name table_id analytics_session_id idempotency_key request_fingerprint').split(' '))
const itemFields = new Set('product_id product_name quantity unit_price notes selected_options ingredient_modifications added_via'.split(' '))
const projected = (columns: string, alias: string) => `to_jsonb((SELECT projected FROM (SELECT ${columns.split(' ').map(c => `${alias}.${c}`).join(', ')}) projected))`
const ok = <T>(data: T): Result<T> => ({ data, error: null })
function tenant(value: string) { if (!UUID.test(value)) throw new OrderDataError(400, 'Invalid tenant') }
function staff(context: OrderContext, tenantId: string) {
  if (context.tenantId !== tenantId || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)) throw new OrderDataError(403, 'Forbidden')
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function rows<T>(result: { rows: Record<string, unknown>[] }, maximum: number): T[] {
  if (result.rows.length > maximum || result.rows.some(({ row }) => !object(row))) throw new OrderDataError(503, 'Order data is unavailable')
  return result.rows.map(({ row }) => row as T)
}

/** Inspect the restored function; runtime never creates functions or grants itself privileges. */
export async function assertOrderRpcCompatibility(query: OrderQuery) {
  const result = await query(`SELECT p.prosecdef AS security_definer, p.proretset AS returns_set,
    p.pronargdefaults AS argument_defaults, p.proargnames AS argument_names, p.proconfig AS settings,
    l.lanname AS language, p.prorettype='jsonb'::regtype AS returns_jsonb,
    p.proargtypes='3802 3802'::oidvector AS jsonb_arguments, p.provolatile='v' AS volatile,
    encode(sha256(convert_to(replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex') AS body_sha256,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS executable,
    NOT row_security_active('public.orders'::regclass) AND NOT row_security_active('public.order_items'::regclass) AS independent_of_auth_rls,
    EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE c.oid=to_regclass('public.orders_tenant_idempotency_key') AND i.indrelid='public.orders'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnatts=2 AND i.indexprs IS NULL
      AND pg_get_expr(i.indpred,i.indrelid)='(idempotency_key IS NOT NULL)'
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['tenant_id','idempotency_key']) AS idempotency_index
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND p.proname='create_order_with_items' LIMIT 2`)
  const row = result.rows[0]
  if (result.rows.length !== 1 || !row || row.security_definer !== false || row.returns_set !== false
    || row.argument_defaults !== 0 || JSON.stringify(row.argument_names) !== '["p_order","p_items"]'
    || JSON.stringify(row.settings) !== '["search_path=public"]' || row.language !== 'plpgsql'
    || row.returns_jsonb !== true || row.jsonb_arguments !== true || row.volatile !== true
    || row.body_sha256 !== ORDER_RPC_BODY_SHA256 || row.executable !== true || row.independent_of_auth_rls !== true
    || row.idempotency_index !== true) throw new OrderDataError(503, 'Order database compatibility must be verified')
}

/** One authorized tenant and one bounded transaction; no generic SQL/Data API facade. */
export class OwnedOrderRepository {
  constructor(private query: OrderQuery, readonly tenantId: string) { tenant(tenantId) }
  async tenantSettings() {
    return ok(rows<{ id: string; is_active: boolean; tenant_settings: Settings | null }>(await this.query(`SELECT
      jsonb_build_object('id',t.id,'is_active',t.is_active,'tenant_settings',CASE WHEN s.tenant_id IS NULL THEN NULL ELSE ${projected(SETTINGS_COLUMNS, 's')} END) AS row
      FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.id=$1 AND t.is_active=true LIMIT 1`, [this.tenantId]), 1)[0] ?? null)
  }
  async locations() {
    return ok(rows<KdsLocation>(await this.query(`SELECT ${projected('id name slug', 'l')} AS row FROM public.locations l
      WHERE l.tenant_id=$1 AND l.is_active=true ORDER BY l.created_at ASC LIMIT 1001`, [this.tenantId]), 1000))
  }
  async kdsBootstrap(context: OrderContext, cutoff: string): Promise<KdsBootstrap> {
    staff(context, this.tenantId)
    const tenant = (await this.tenantSettings()).data
    if (!tenant?.is_active) throw new OrderDataError(404, 'Tenant not available')
    const settings = tenant.tenant_settings
    const capabilities = await this.capabilities(settings)
    const orders = await this.list(context, cutoff)
    const locations = await this.locations()
    const threshold = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
    return {
      orders: orders.data,
      locations: locations.data,
      capabilities,
      amberThreshold: threshold(settings?.amber_threshold_minutes, 10),
      redThreshold: threshold(settings?.red_threshold_minutes, 20),
      currency: typeof settings?.currency === 'string' ? settings.currency : 'USD',
    }
  }
  async capabilities(settings?: Settings | null) {
    const source = await this.query(`SELECT CASE WHEN s.status IN ('active','trial') THEN p.features ELSE '[]'::jsonb END AS features
      FROM public.tenant_subscriptions s JOIN public.plans p ON p.id=s.plan_id
      JOIN public.tenants t ON t.id=s.tenant_id AND t.is_active=true WHERE s.tenant_id=$1 LIMIT 2`, [this.tenantId])
    if (source.rows.length > 1) throw new OrderDataError(503, 'Order subscription data is unavailable')
    const features = source.rows[0]?.features ?? []
    if (!Array.isArray(features) || features.some(f => typeof f !== 'string')) throw new OrderDataError(503, 'Order subscription data is unavailable')
    const resolved = settings === undefined ? (await this.tenantSettings()).data?.tenant_settings : settings
    return resolveTenantCapabilities(features, resolved)
  }
  async stripeEnabled() {
    const capabilities = await this.capabilities(null)
    if (!capabilities.plan.stripe) return false
    // Presence only: no Stripe credentials, SDK call or payment mutation.
    const result = await this.query('SELECT id FROM public.stripe_connections WHERE tenant_id=$1 AND is_active=true LIMIT 2', [this.tenantId])
    if (result.rows.length > 1) throw new OrderDataError(503, 'Order payment configuration is unavailable')
    return result.rows.length === 1
  }
  async analyticsSession(id: string) {
    await this.query('SAVEPOINT order_analytics_lookup')
    try {
      const session = rows<{ id: string; menu_id: string; location_id: string | null }>(await this.query(`SELECT ${projected('id menu_id location_id', 's')} AS row
        FROM public.menu_sessions s JOIN public.menus m ON m.id=s.menu_id AND m.tenant_id=$1
        WHERE s.tenant_id=$1 AND s.id=$2 LIMIT 1`, [this.tenantId, id]), 1)[0] ?? null
      await this.query('RELEASE SAVEPOINT order_analytics_lookup')
      return ok(session)
    } catch {
      // Optional attribution errors abort a PG transaction unless rolled back.
      // Retain the legacy behavior: no attribution, but checkout may continue.
      await this.query('ROLLBACK TO SAVEPOINT order_analytics_lookup')
      await this.query('RELEASE SAVEPOINT order_analytics_lookup')
      return ok(null)
    }
  }
  async location(id: string) {
    return ok(rows<{ id: string }>(await this.query(`SELECT jsonb_build_object('id',id) AS row FROM public.locations
      WHERE tenant_id=$1 AND id=$2 AND is_active=true LIMIT 1`, [this.tenantId, id]), 1)[0] ?? null)
  }
  async table(id: string) {
    return ok(rows<{ id: string; name: string }>(await this.query(`SELECT ${projected('id name', 't')} AS row FROM public.restaurant_tables t
      WHERE t.tenant_id=$1 AND t.id=$2 AND t.is_active=true LIMIT 1`, [this.tenantId, id]), 1)[0] ?? null)
  }
  async products(ids: string[]) {
    this.productIds(ids)
    return ok(rows<Product>(await this.query(`SELECT ${projected('id tenant_id name price is_available menu_id', 'p')}
      ||jsonb_build_object('menus',${projected('id is_active is_private price_multiplier', 'm')}) AS row
      FROM public.products p JOIN public.menus m ON m.id=p.menu_id AND m.tenant_id=$1
      WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY p.id FOR SHARE OF p,m`, [this.tenantId, ids]), 50))
  }
  async optionGroups(ids: string[]) {
    this.productIds(ids)
    return ok(rows<Record<string, unknown>>(await this.query(`SELECT ${projected('id product_id name type required min_selections max_selections position', 'g')}
      || jsonb_build_object('product_options',COALESCE((SELECT jsonb_agg(${projected('id name base_price price_modifier is_available', 'o')} ORDER BY o.position,o.id)
        FROM public.product_options o WHERE o.group_id=g.id AND o.tenant_id=$1),'[]'::jsonb)) AS row
      FROM public.product_option_groups g JOIN public.products p ON p.id=g.product_id AND p.tenant_id=$1
      WHERE g.tenant_id=$1 AND g.product_id=ANY($2::uuid[]) ORDER BY g.position,g.id LIMIT 1001`, [this.tenantId, ids]), 1000))
  }
  async ingredients(ids: string[]) {
    this.productIds(ids)
    return ok(rows<Record<string, unknown>>(await this.query(`SELECT ${projected('product_id ingredient_id extra_price_override add_price_override', 'pi')}
      ||jsonb_build_object('ingredients',${projected('name default_extra_price default_add_price', 'i')}) AS row
      FROM public.product_ingredients pi JOIN public.ingredients i ON i.id=pi.ingredient_id AND i.tenant_id=$1
      JOIN public.products p ON p.id=pi.product_id AND p.tenant_id=$1
      WHERE pi.tenant_id=$1 AND pi.product_id=ANY($2::uuid[]) ORDER BY pi.product_id,pi.ingredient_id LIMIT 5001`, [this.tenantId, ids]), 5000))
  }
  async deliveryZones() {
    return ok(rows<{ id: string; fee_cents: number; zipcode_prefixes: string[] }>(await this.query(`SELECT ${projected('id fee_cents zipcode_prefixes', 'z')} AS row
      FROM public.delivery_zones z WHERE z.tenant_id=$1 AND z.is_active=true ORDER BY z.created_at,z.id LIMIT 1001`, [this.tenantId]), 1000))
  }
  async create(order: Record<string, unknown>, items: Array<Record<string, unknown>>, verifiedCustomerId: string | null): Promise<Result<CreatedOrder | null>> {
    if (Object.keys(order).some(key => !orderFields.has(key)) || order.tenant_id !== this.tenantId
      || order.customer_id !== verifiedCustomerId || (verifiedCustomerId !== null && !UUID.test(verifiedCustomerId))
      || !['pending', 'awaiting_payment'].includes(String(order.status)) || items.length < 1 || items.length > 50
      || items.some(item => Object.keys(item).some(key => !itemFields.has(key)) || !UUID.test(String(item.product_id))
        || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 99)
      || JSON.stringify({ order, items }).length > 1048576) throw new OrderDataError(400, 'Invalid order')
    const ids = [...new Set(items.map(item => String(item.product_id)))]
    const products = (await this.products(ids)).data
    if (products.length !== ids.length || new Set(products.map(p => p.menu_id)).size !== 1
      || products.some(p => p.is_available === false || p.menus.is_active === false)) throw new OrderDataError(409, 'One or more items are no longer available')
    for (const [field, table] of [['location_id', 'locations'], ['table_id', 'restaurant_tables'], ['delivery_zone_id', 'delivery_zones'], ['analytics_session_id', 'menu_sessions']] as const) {
      if (order[field] === null || order[field] === undefined) continue
      if (!UUID.test(String(order[field]))) throw new OrderDataError(400, 'Invalid order reference')
      const found = await this.query(`SELECT id FROM public.${table} WHERE tenant_id=$1 AND id=$2${table === 'menu_sessions' ? '' : ' AND is_active=true'} LIMIT 1 FOR SHARE`, [this.tenantId, order[field]])
      if (found.rows.length !== 1) throw new OrderDataError(400, 'Invalid order reference')
    }
    await assertOrderRpcCompatibility(this.query)
    const created = rows<CreatedOrder>(await this.query('SELECT public.create_order_with_items($1::jsonb,$2::jsonb) AS row', [JSON.stringify(order), JSON.stringify(items)]), 1)[0]
    if (!created || !UUID.test(created.id) || !['pending','awaiting_payment','paid','payment_failed','preparing','ready','out_for_delivery','done','cancelled'].includes(created.status)
      || typeof created.replayed !== 'boolean') throw new OrderDataError(503, 'Order creation result is unavailable')
    return ok(created)
  }
  async list(context: OrderContext, cutoff: string) {
    staff(context, this.tenantId)
    if (!Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) < Date.now() - 49 * 3600000) throw new OrderDataError(400, 'Invalid order window')
    const found = rows<KdsOrder>(await this.query(`SELECT ${projected(ORDER_COLUMNS, 'o')}
      || jsonb_build_object('order_items',COALESCE((SELECT jsonb_agg(items.row ORDER BY items.id) FROM
        (SELECT oi.id,${projected(ITEM_COLUMNS, 'oi')} AS row FROM public.order_items oi WHERE oi.order_id=o.id ORDER BY oi.id LIMIT 1001) items),'[]'::jsonb)) AS row
      FROM public.orders o WHERE o.tenant_id=$1 AND o.created_at >= $2::timestamptz ORDER BY o.created_at DESC,o.id DESC LIMIT 500`, [this.tenantId, cutoff]), 500)
    if (found.some(order => order.tenant_id !== this.tenantId || !Array.isArray(order.order_items) || order.order_items.length > 1000)) throw new OrderDataError(503, 'Order data is unavailable')
    return ok(found)
  }
  async move(context: OrderContext, id: string, status: OrderStatus) {
    staff(context, this.tenantId)
    if (!UUID.test(id) || !isOrderStatus(status)) throw new OrderDataError(400, 'Invalid order')
    const existing = (await this.query('SELECT id,status,order_type FROM public.orders WHERE tenant_id=$1 AND id=$2 LIMIT 1', [this.tenantId, id])).rows[0]
    if (!existing) throw new OrderDataError(404, 'Order not found')
    if (!isOrderStatus(existing.status)) throw new OrderDataError(503, 'Order status is unavailable')
    if (existing.status === status) return { id, status }
    if (!canKitchenMove(existing.status, status, String(existing.order_type))) throw new OrderDataError(409, `An order cannot go from ${existing.status} to ${status}`)
    const updated = (await this.query('UPDATE public.orders SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status=$4 RETURNING id,status', [this.tenantId, id, status, existing.status])).rows[0]
    if (!updated) throw new OrderDataError(409, 'The order changed meanwhile, refresh and try again')
    if (status === 'done' || status === 'cancelled') await this.recordAnalytics(id, status === 'done' ? 'order_completed' : 'order_cancelled')
    return { id: String(updated.id), status: String(updated.status) }
  }
  async recordAnalytics(id: string, event: 'order_created' | 'order_completed' | 'order_cancelled') {
    if (!UUID.test(id) || !['order_created','order_completed','order_cancelled'].includes(event)) return
    await this.query('SAVEPOINT order_analytics')
    try {
      await this.query(`INSERT INTO public.menu_events(client_event_id,server_event_key,tenant_id,session_id,menu_id,location_id,order_id,event_name,occurred_at,amount,source)
        SELECT $3::uuid,$4,o.tenant_id,s.id,s.menu_id,s.location_id,o.id,$5,now(),CASE WHEN $5='order_cancelled' THEN NULL ELSE o.total END,'checkout'
        FROM public.orders o JOIN public.menu_sessions s ON s.id=o.analytics_session_id AND s.tenant_id=$1
        JOIN public.menus m ON m.id=s.menu_id AND m.tenant_id=$1
        WHERE o.tenant_id=$1 AND o.id=$2 AND (s.location_id IS NULL OR EXISTS(SELECT 1 FROM public.locations l WHERE l.id=s.location_id AND l.tenant_id=$1))
        ON CONFLICT(server_event_key) DO NOTHING`, [this.tenantId, id, randomUUID(), `order:${id}:${event}`, event])
    } catch { await this.query('ROLLBACK TO SAVEPOINT order_analytics') }
    await this.query('RELEASE SAVEPOINT order_analytics')
  }
  private productIds(ids: string[]) {
    if (!ids.length || ids.length > 50 || ids.some(id => !UUID.test(id))) throw new OrderDataError(400, 'Invalid products')
  }
}
