/**
 * Input contract of POST /api/orders (EX-03). Bounds every field a client can
 * send, so a crafted payload cannot reach pricing or the database with huge
 * carts, absurd strings or malformed ids. Prices, product names and option
 * labels in the payload are accepted for compatibility and ignored: the server
 * derives them from the catalog.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

const uuid = z.string().uuid()
const text = (max: number) => z.string().max(max)
const optionalText = (max: number) => text(max).nullish()

const ingredientRef = z.object({
  ingredient_id: uuid,
  name: text(200).optional(),
  qty: z.number().int().min(0).max(99).optional(),
  unit_price: z.number().optional(),
})

export const editorStateSchema = z.object({
  singleSelections: z.record(uuid, uuid).optional(),
  halfSelections: z.record(uuid, z.object({ half1: uuid.nullable(), half2: uuid.nullable() })).optional(),
  multiSelections: z.record(uuid, z.array(uuid).max(50)).optional(),
}).passthrough()

export const orderItemSchema = z.object({
  product_id: uuid,
  quantity: z.number().int().min(1).max(99),
  // Ignored (recomputed / derived server-side); kept so current clients validate.
  product_name: text(300).optional(),
  unit_price: z.number().optional(),
  selected_options: z.record(z.string(), z.unknown()).nullish(),
  notes: optionalText(500),
  ingredient_modifications: z.object({
    removed: z.array(ingredientRef).max(50).default([]),
    extras: z.array(ingredientRef).max(50).default([]),
    added: z.array(ingredientRef).max(50).default([]),
  }).nullish(),
  editor_state: editorStateSchema.nullish(),
  added_via: z.unknown().optional(),
})

export const createOrderSchema = z.object({
  tenant_id: uuid,
  customer_name: text(120).refine((s) => s.trim().length > 0, 'Customer name is required'),
  customer_phone: text(40).refine((s) => s.trim().length > 0, 'Customer phone is required'),
  items: z.array(orderItemSchema).min(1, 'At least one item is required').max(50, 'Too many items in one order'),
  order_type: z.union([z.enum(['dine_in', 'pickup', 'delivery']), z.literal('')]).nullish(),
  delivery_address: optionalText(300),
  delivery_street: optionalText(200),
  delivery_complement: optionalText(120),
  delivery_zipcode: optionalText(20),
  delivery_city: optionalText(120),
  delivery_notes: optionalText(300),
  location_id: uuid.nullish(),
  tip_cents: z.number().int().min(0).max(1_000_000).nullish(),
  menu_id: uuid.nullish(),
  table_name: optionalText(80),
  table_id: z.string().max(64).nullish(),
  analytics_session_id: z.string().max(64).nullish(),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type OrderItemInput = z.infer<typeof orderItemSchema>

/** First problem of a failed parse, as a short message for the 400 response. */
export function describeInputError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid order'
  const path = issue.path.join('.')
  if (path.startsWith('items.') && path.endsWith('quantity')) return 'Invalid item quantity'
  if (path.startsWith('items.')) return 'Invalid item'
  if (issue.message && !issue.message.startsWith('Invalid') && !issue.message.startsWith('Expected')) return issue.message
  return path === 'order_type' ? 'Invalid order type' : `Invalid ${path || 'order'}`
}

/** Idempotency key from the request header: opaque, bounded, optional. */
export function parseIdempotencyKey(header: string | null): string | null {
  const key = header?.trim()
  if (!key) return null
  return /^[A-Za-z0-9_-]{8,128}$/.test(key) ? key : null
}

/** Stable hash of what decides an order, to tell a replay from a different order under the same key. */
export function orderFingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
    }
    return v
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
