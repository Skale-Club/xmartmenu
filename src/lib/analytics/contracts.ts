import { z } from 'zod'

export const MAX_ANALYTICS_BATCH_SIZE = 50
export const MAX_ANALYTICS_BODY_BYTES = 64 * 1024
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000
export const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000

export const clientAnalyticsEventNames = [
  'menu_session_started',
  'product_impression',
  'product_engagement',
  'product_detail_opened',
  'media_started',
  'media_completed',
  'media_swiped',
  'category_selected',
  'search_performed',
  'product_customization_started',
  'add_to_cart',
  'remove_from_cart',
  'checkout_started',
] as const

export const serverAnalyticsEventNames = [
  'order_created',
  'order_completed',
  'order_cancelled',
] as const

const productEventNames = new Set<string>([
  'product_impression',
  'product_engagement',
  'product_detail_opened',
  'media_started',
  'media_completed',
  'media_swiped',
  'product_customization_started',
  'add_to_cart',
  'remove_from_cart',
])

const uuidSchema = z.string().uuid()

export const analyticsSessionSchema = z.strictObject({
  id: uuidSchema,
  tenant_id: uuidSchema,
  menu_id: uuidSchema,
  location_id: uuidSchema.nullish(),
  qr_code_id: uuidSchema.nullish(),
  entry_source: z.enum(['qr', 'direct', 'custom_domain', 'unknown']).default('unknown'),
  device_class: z.enum(['mobile', 'tablet', 'desktop', 'unknown']).default('unknown'),
  language: z.string().trim().min(2).max(16).nullish(),
  is_test: z.boolean().default(false),
})

export const clientAnalyticsEventSchema = z.strictObject({
  client_event_id: uuidSchema,
  event_name: z.enum(clientAnalyticsEventNames),
  occurred_at: z.string().datetime({ offset: true }),
  product_id: uuidSchema.nullish(),
  category_id: uuidSchema.nullish(),
  duration_ms: z.number().int().min(0).max(3_600_000).nullish(),
  quantity: z.number().int().min(1).max(99).nullish(),
  source: z.enum(['grid', 'featured', 'detail', 'cart', 'checkout', 'feed', 'search', 'unknown']).nullish(),
  media_type: z.enum(['image', 'video']).nullish(),
  media_index: z.number().int().min(0).max(20).nullish(),
  query_length: z.number().int().min(0).max(200).nullish(),
}).superRefine((event, ctx) => {
  if (productEventNames.has(event.event_name) && !event.product_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['product_id'],
      message: `${event.event_name} requires product_id`,
    })
  }
  if (event.event_name === 'product_engagement' && !event.duration_ms) {
    ctx.addIssue({
      code: 'custom',
      path: ['duration_ms'],
      message: 'product_engagement requires a positive duration_ms',
    })
  }
  if (event.event_name === 'category_selected' && !event.category_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['category_id'],
      message: 'category_selected requires category_id',
    })
  }
  if (event.event_name === 'search_performed' && event.query_length == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['query_length'],
      message: 'search_performed requires query_length',
    })
  }
  if ((event.event_name === 'add_to_cart' || event.event_name === 'remove_from_cart') && !event.quantity) {
    ctx.addIssue({
      code: 'custom',
      path: ['quantity'],
      message: `${event.event_name} requires quantity`,
    })
  }
})

export const analyticsBatchSchema = z.strictObject({
  session: analyticsSessionSchema,
  events: z.array(clientAnalyticsEventSchema).min(1).max(MAX_ANALYTICS_BATCH_SIZE),
})

export type AnalyticsSessionInput = z.infer<typeof analyticsSessionSchema>
export type ClientAnalyticsEventInput = z.infer<typeof clientAnalyticsEventSchema>
export type AnalyticsBatchInput = z.infer<typeof analyticsBatchSchema>

export function validateEventTimes(
  events: ClientAnalyticsEventInput[],
  nowMs = Date.now(),
): boolean {
  return events.every((event) => {
    const occurredAt = Date.parse(event.occurred_at)
    return Number.isFinite(occurredAt)
      && occurredAt >= nowMs - MAX_EVENT_AGE_MS
      && occurredAt <= nowMs + MAX_EVENT_FUTURE_SKEW_MS
  })
}
