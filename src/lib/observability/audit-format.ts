/**
 * Turns an audit_events row into lines a person can read:
 *   update  → "price: 20 → 24", "is_available: true → false"
 *   insert  → "created: name = Classic Burger, price = 20"
 *   delete  → "deleted: name = Classic Burger"
 */
export interface AuditChange {
  field: string
  from?: string
  to?: string
}

const MAX_VALUE = 80
// On insert/delete, show these first: they say what the row was.
const IDENTIFYING = ['name', 'slug', 'title', 'status', 'price', 'role', 'email', 'label']
const NOISE = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'position'])

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text
}

export function summarizeChanges(action: string, changes: Record<string, unknown> | null | undefined, limit = 6): AuditChange[] {
  const entries = Object.entries(changes ?? {})
  if (action === 'update') {
    return entries.slice(0, limit).map(([field, pair]) => {
      const [from, to] = Array.isArray(pair) ? pair : [undefined, pair]
      return { field, from: formatValue(from), to: formatValue(to) }
    })
  }
  const ordered = [
    ...IDENTIFYING.filter(key => key in (changes ?? {})).map(key => [key, (changes ?? {})[key]] as const),
    ...entries.filter(([key]) => !IDENTIFYING.includes(key) && !NOISE.has(key)),
  ]
  return ordered.slice(0, limit).map(([field, value]) => ({ field, to: formatValue(value) }))
}

export const TABLE_LABELS: Record<string, string> = {
  tenants: 'Restaurant',
  tenant_settings: 'Settings',
  tenant_subscriptions: 'Subscription',
  plans: 'Plan',
  platform_settings: 'Platform settings',
  profiles: 'User',
  menus: 'Menu',
  categories: 'Category',
  products: 'Dish',
  product_option_groups: 'Option group',
  product_options: 'Option',
  product_media: 'Dish media',
  ingredients: 'Ingredient',
  product_ingredients: 'Dish ingredient',
  restaurant_tables: 'Table',
  locations: 'Location',
  delivery_zones: 'Delivery zone',
  chat_addon_settings: 'AI chat settings',
  platform_ai_settings: 'AI global settings',
  tenant_ai_settings: 'AI billing settings',
  stripe_connections: 'Stripe connection',
  qr_codes: 'QR code',
  orders: 'Order',
}

export const VIA_LABELS: Record<string, string> = {
  browser: 'Admin (browser)',
  server: 'Server',
  anon: 'Guest',
  sql: 'SQL / system',
}
