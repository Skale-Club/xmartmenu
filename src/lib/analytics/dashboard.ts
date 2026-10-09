export interface AnalyticsOverview {
  sessions: number
  engaged_sessions: number
  detail_sessions: number
  cart_sessions: number
  checkout_sessions: number
  completed_orders: number
  cancelled_orders: number
  revenue: number
  avg_order_value: number
  revenue_per_session: number
  median_time_to_order_seconds: number
}

export interface ProductAnalyticsRow {
  product_id: string
  product_name: string
  impression_sessions: number
  engaged_sessions: number
  detail_sessions: number
  add_sessions: number
  remove_sessions: number
  attention_ms: number
  purchased_sessions: number
  purchased_quantity: number
  revenue: number
}

export interface ProductAnalyticsMetrics extends ProductAnalyticsRow {
  detail_rate: number
  add_rate: number
  remove_rate: number
  purchase_rate: number
  avg_attention_seconds: number
  has_enough_data: boolean
}

export interface AnalyticsRecommendation {
  id: string
  product_id: string
  product_name: string
  title: string
  evidence: string
  action: string
  kind: 'opportunity' | 'friction' | 'content' | 'complexity'
}

export const EMPTY_ANALYTICS_OVERVIEW: AnalyticsOverview = {
  sessions: 0,
  engaged_sessions: 0,
  detail_sessions: 0,
  cart_sessions: 0,
  checkout_sessions: 0,
  completed_orders: 0,
  cancelled_orders: 0,
  revenue: 0,
  avg_order_value: 0,
  revenue_per_session: 0,
  median_time_to_order_seconds: 0,
}

function numberValue(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function normalizeOverview(value: unknown): AnalyticsOverview {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(
    Object.keys(EMPTY_ANALYTICS_OVERVIEW).map(key => [key, numberValue(row[key])]),
  ) as unknown as AnalyticsOverview
}

export function normalizeProductAnalytics(value: unknown): ProductAnalyticsRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.product_id !== 'string' || typeof row.product_name !== 'string') return null
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    impression_sessions: numberValue(row.impression_sessions),
    engaged_sessions: numberValue(row.engaged_sessions),
    detail_sessions: numberValue(row.detail_sessions),
    add_sessions: numberValue(row.add_sessions),
    remove_sessions: numberValue(row.remove_sessions),
    attention_ms: numberValue(row.attention_ms),
    purchased_sessions: numberValue(row.purchased_sessions),
    purchased_quantity: numberValue(row.purchased_quantity),
    revenue: numberValue(row.revenue),
  }
}

export function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.max(0, Math.min(1, numerator / denominator))
}

export function enrichProductAnalytics(
  row: ProductAnalyticsRow,
  minimumImpressions = 20,
): ProductAnalyticsMetrics {
  return {
    ...row,
    detail_rate: safeRate(row.detail_sessions, row.impression_sessions),
    add_rate: safeRate(row.add_sessions, row.impression_sessions),
    remove_rate: safeRate(row.remove_sessions, row.add_sessions),
    purchase_rate: safeRate(row.purchased_sessions, row.impression_sessions),
    avg_attention_seconds: row.engaged_sessions > 0
      ? row.attention_ms / row.engaged_sessions / 1_000
      : 0,
    has_enough_data: row.impression_sessions >= minimumImpressions,
  }
}

export function buildRecommendations(
  products: ProductAnalyticsMetrics[],
  maximum = 6,
): AnalyticsRecommendation[] {
  const candidates: Array<AnalyticsRecommendation & { score: number }> = []

  for (const product of products) {
    if (!product.has_enough_data) continue

    if (product.purchase_rate >= 0.12 && product.impression_sessions < 100) {
      candidates.push({
        id: `${product.product_id}:exposure`,
        product_id: product.product_id,
        product_name: product.product_name,
        title: 'Strong conversion, limited exposure',
        evidence: `${formatPercent(product.purchase_rate)} of ${product.impression_sessions} viewing sessions purchased this item.`,
        action: 'Consider featuring it or moving it higher in the menu.',
        kind: 'opportunity',
        score: product.purchase_rate * 100,
      })
    }

    if (product.avg_attention_seconds >= 5 && product.add_rate < 0.08) {
      candidates.push({
        id: `${product.product_id}:attention`,
        product_id: product.product_id,
        product_name: product.product_name,
        title: 'Attention is not becoming cart intent',
        evidence: `Average active attention is ${product.avg_attention_seconds.toFixed(1)}s, but only ${formatPercent(product.add_rate)} added it.`,
        action: 'Review the price, portion clarity, description, and primary photo.',
        kind: 'content',
        score: product.avg_attention_seconds * (1 - product.add_rate),
      })
    }

    if (product.add_sessions >= 10 && product.remove_rate >= 0.35) {
      candidates.push({
        id: `${product.product_id}:removal`,
        product_id: product.product_id,
        product_name: product.product_name,
        title: 'Frequent cart removal',
        evidence: `${formatPercent(product.remove_rate)} of sessions that added this item later removed it.`,
        action: 'Check option pricing, fees, and whether the card matches the detailed offer.',
        kind: 'friction',
        score: product.remove_rate * product.add_sessions,
      })
    }

    if (product.detail_rate >= 0.3 && product.purchase_rate < 0.05) {
      candidates.push({
        id: `${product.product_id}:details`,
        product_id: product.product_id,
        product_name: product.product_name,
        title: 'Details attract interest, purchase stays low',
        evidence: `${formatPercent(product.detail_rate)} opened details while ${formatPercent(product.purchase_rate)} purchased.`,
        action: 'Simplify customization or strengthen value and ingredient information.',
        kind: 'complexity',
        score: product.detail_rate * (1 - product.purchase_rate) * 10,
      })
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, maximum)
    .map(candidate => ({
      id: candidate.id,
      product_id: candidate.product_id,
      product_name: candidate.product_name,
      title: candidate.title,
      evidence: candidate.evidence,
      action: candidate.action,
      kind: candidate.kind,
    }))
}

export function formatPercent(rate: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(rate)
}
