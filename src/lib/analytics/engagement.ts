/**
 * Screen time and audience (get_menu_engagement RPC) and the superadmin's
 * cross-client overview (get_platform_menu_overview). Pure normalisers and
 * labels; tested in tests/unit/analytics/engagement.test.ts.
 */

export interface CountRow {
  key: string
  sessions: number
}

export interface MenuEngagement {
  sessions: number
  median_seconds: number
  avg_seconds: number
  duration: CountRow[]
  by_hour: CountRow[]
  by_weekday: CountRow[]
  devices: CountRow[]
  sources: CountRow[]
  languages: CountRow[]
}

export const EMPTY_ENGAGEMENT: MenuEngagement = {
  sessions: 0, median_seconds: 0, avg_seconds: 0, duration: [], by_hour: [], by_weekday: [], devices: [], sources: [], languages: [],
}

const num = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

function rows(raw: unknown): CountRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({ key: String(r.key ?? 'unknown'), sessions: num(r.sessions) }))
}

export function normalizeEngagement(raw: unknown): MenuEngagement {
  if (!raw || typeof raw !== 'object') return EMPTY_ENGAGEMENT
  const r = raw as Record<string, unknown>
  return {
    sessions: num(r.sessions),
    median_seconds: num(r.median_seconds),
    avg_seconds: num(r.avg_seconds),
    duration: rows(r.duration),
    by_hour: rows(r.by_hour),
    by_weekday: rows(r.by_weekday),
    devices: rows(r.devices),
    sources: rows(r.sources),
    languages: rows(r.languages),
  }
}

/** 45 → "45s", 135 → "2m 15s", 3900 → "1h 5m". */
export function formatDuration(seconds: number): string {
  const s = Math.round(Math.max(0, seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const rest = s % 60
    return rest ? `${m}m ${rest}s` : `${m}m`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

/** The busiest hour, e.g. { hour: 20, sessions: 31 }, or null without data. */
export function peakHour(engagement: MenuEngagement): { hour: number; sessions: number } | null {
  const best = engagement.by_hour.reduce<CountRow | null>((top, r) => (r.sessions > (top?.sessions ?? 0) ? r : top), null)
  return best ? { hour: Number(best.key), sessions: best.sessions } : null
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const DEVICE_LABELS: Record<string, string> = { mobile: 'Phone', tablet: 'Tablet', desktop: 'Computer', unknown: 'Unknown' }
export const SOURCE_LABELS: Record<string, string> = { qr: 'QR code / NFC', direct: 'Link', custom_domain: 'Own domain', unknown: 'Unknown' }

/** Share of sessions, 0–1. */
export function share(row: CountRow, total: number): number {
  return total > 0 ? row.sessions / total : 0
}

export interface PlatformTenantRow {
  tenant_id: string
  name: string
  slug: string
  plan: string | null
  currency: string
  sessions: number
  median_seconds: number
  orders: number
  revenue: number
  waiter_calls: number
}

export function normalizePlatformOverview(raw: unknown): PlatformTenantRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof r.tenant_id === 'string')
    .map(r => ({
      tenant_id: r.tenant_id as string,
      name: typeof r.name === 'string' ? r.name : '',
      slug: typeof r.slug === 'string' ? r.slug : '',
      plan: typeof r.plan === 'string' ? r.plan : null,
      currency: typeof r.currency === 'string' && r.currency ? r.currency : 'USD',
      sessions: num(r.sessions),
      median_seconds: num(r.median_seconds),
      orders: num(r.orders),
      revenue: num(r.revenue),
      waiter_calls: num(r.waiter_calls),
    }))
}
