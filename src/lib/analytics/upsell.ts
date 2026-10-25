/**
 * "Complete your order" numbers for the restaurant dashboard, from the
 * get_menu_upsell_analytics RPC (see migration 20261025140000).
 */
export interface UpsellTopItem {
  product_id: string | null
  name: string
  items: number
  value: number
}

export interface UpsellAnalytics {
  /** Sequences opened after a dish was added. */
  shown: number
  /** Sequences closed without taking anything. */
  skipped: number
  /** Suggestions added to carts (sum of quantities). */
  accepted_items: number
  /** Estimated value of those suggestions at today's prices. */
  accepted_value: number
  top: UpsellTopItem[]
}

export const EMPTY_UPSELL_ANALYTICS: UpsellAnalytics = { shown: 0, skipped: 0, accepted_items: 0, accepted_value: 0, top: [] }

const num = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

export function normalizeUpsellAnalytics(raw: unknown): UpsellAnalytics {
  if (!raw || typeof raw !== 'object') return EMPTY_UPSELL_ANALYTICS
  const row = raw as Record<string, unknown>
  const top = Array.isArray(row.top) ? row.top : []
  return {
    shown: num(row.shown),
    skipped: Math.min(num(row.skipped), num(row.shown)),
    accepted_items: num(row.accepted_items),
    accepted_value: num(row.accepted_value),
    top: top
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        product_id: typeof item.product_id === 'string' ? item.product_id : null,
        name: typeof item.name === 'string' && item.name ? item.name : 'Removed dish',
        items: num(item.items),
        value: num(item.value),
      })),
  }
}

/** Share of sequences where the guest took at least one suggestion. */
export function upsellTakeRate(data: UpsellAnalytics): number {
  return data.shown > 0 ? (data.shown - data.skipped) / data.shown : 0
}
