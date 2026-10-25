/**
 * What the AI menu assistant knows about the restaurant beyond the menu: its
 * profile (or the location the customer is at), its opening hours and whether
 * it is open right now, and how ordering works there — the same rules the
 * menu page and checkout apply.
 *
 * Pure functions only; the chat route loads the rows and passes them in.
 */

// ── Ordering rules ─────────────────────────────────────────────────────────

export interface OrderSettings {
  orders_enabled?: boolean | null
  direct_orders_enabled?: boolean | null
  whatsapp_orders_enabled?: boolean | null
  whatsapp?: string | null
  dine_in_enabled?: boolean | null
  pickup_enabled?: boolean | null
  pickup_eta_minutes?: number | null
  delivery_enabled?: boolean | null
  delivery_fee_cents?: number | null
  tips_enabled?: boolean | null
  currency?: string | null
}

/**
 * - cart: the menu page shows the cart (direct_orders_enabled) and checkout
 *   accepts it (orders_enabled) — the only mode where the assistant may add items.
 * - whatsapp: the page sends orders to WhatsApp instead of a cart.
 * - browse: the menu is for browsing only.
 */
export type OrderingMode = 'cart' | 'whatsapp' | 'browse'

export function resolveOrderingMode(s: OrderSettings): OrderingMode {
  // Same defaults as MenuPage: orders_enabled defaults on, direct orders off.
  // Checkout rejects anything unless orders_enabled is explicitly true.
  if (s.orders_enabled === true && s.direct_orders_enabled === true) return 'cart'
  if ((s.orders_enabled ?? true) && s.whatsapp_orders_enabled && s.whatsapp) return 'whatsapp'
  return 'browse'
}

export function formatMoney(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim()
  }
}

export interface DeliveryZone {
  name: string
  fee_cents: number
}

export function describeOrdering(
  s: OrderSettings,
  opts: { onlinePayment: boolean; deliveryZones: DeliveryZone[] },
): string {
  const mode = resolveOrderingMode(s)
  if (mode === 'browse') {
    return 'This menu is for browsing only: orders cannot be placed here. You CANNOT add items to a cart. If the customer wants to order, suggest contacting the restaurant (see the profile above).'
  }
  if (mode === 'whatsapp') {
    return `Orders are placed through WhatsApp (${s.whatsapp}), using the WhatsApp button on each dish. You CANNOT add items to a cart. Help the customer choose, then tell them to order through WhatsApp.`
  }

  const currency = s.currency ?? null
  const types: string[] = []
  if (s.dine_in_enabled ?? true) types.push('dine-in (eat at the restaurant)')
  if (s.pickup_enabled) {
    const eta = s.pickup_eta_minutes ? `, ready in about ${s.pickup_eta_minutes} minutes` : ''
    types.push(`pickup${eta}`)
  }
  if (s.delivery_enabled) {
    if (opts.deliveryZones.length) {
      const zones = opts.deliveryZones.map((z) => `${z.name} ${formatMoney(z.fee_cents / 100, currency)}`).join(', ')
      types.push(`delivery (fee depends on the area: ${zones}; addresses outside these areas are not served)`)
    } else {
      const fee = s.delivery_fee_cents ? `fee ${formatMoney(s.delivery_fee_cents / 100, currency)}` : 'no delivery fee'
      types.push(`delivery (${fee})`)
    }
  }

  const payment = opts.onlinePayment
    ? 'Payment is online, by card, at checkout (secure Stripe payment). The order only goes to the kitchen once it is paid.'
    : 'There is no online payment: the customer pays in person (at the restaurant, on pickup or on delivery). If they ask which payment methods are accepted, tell them to check with the restaurant.'

  return `Orders are placed through the cart on this page. You CAN add items with the addToCart tool.
- Order types available: ${types.length ? types.join('; ') : 'not configured'}. Only offer these.
- ${payment}
${s.tips_enabled ? '- Customers can add an optional tip at checkout.\n' : ''}- How it works: you add the items, the cart opens, and the customer reviews it and taps checkout to choose the order type, enter name and phone (and the address for delivery)${opts.onlinePayment ? ' and pay' : ''}. You cannot place the order yourself.`
}

// ── Time zone ──────────────────────────────────────────────────────────────

const US_STATE_TZ: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago',
  WY: 'America/Denver', PR: 'America/Puerto_Rico',
}

const BR_STATE_TZ: Record<string, string> = {
  AC: 'America/Rio_Branco', AM: 'America/Manaus', RR: 'America/Boa_Vista', RO: 'America/Porto_Velho',
  MT: 'America/Cuiaba', MS: 'America/Campo_Grande',
  PA: 'America/Belem', AP: 'America/Belem', MA: 'America/Fortaleza', PI: 'America/Fortaleza', CE: 'America/Fortaleza',
  RN: 'America/Fortaleza', PB: 'America/Fortaleza', PE: 'America/Recife', AL: 'America/Maceio', SE: 'America/Maceio',
  BA: 'America/Bahia', TO: 'America/Araguaina',
}

const CA_PROVINCE_TZ: Record<string, string> = {
  BC: 'America/Vancouver', AB: 'America/Edmonton', SK: 'America/Regina', MB: 'America/Winnipeg', ON: 'America/Toronto',
  QC: 'America/Toronto', NB: 'America/Halifax', NS: 'America/Halifax', PE: 'America/Halifax', NL: 'America/St_Johns',
}

const COUNTRY_TZ: Record<string, string> = {
  BR: 'America/Sao_Paulo', US: 'America/New_York', CA: 'America/Toronto', MX: 'America/Mexico_City',
  AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
  UY: 'America/Montevideo', PY: 'America/Asuncion', BO: 'America/La_Paz', EC: 'America/Guayaquil', VE: 'America/Caracas',
  PT: 'Europe/Lisbon', ES: 'Europe/Madrid', FR: 'Europe/Paris', IT: 'Europe/Rome', DE: 'Europe/Berlin', GB: 'Europe/London',
  IE: 'Europe/Dublin', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', AO: 'Africa/Luanda',
  MZ: 'Africa/Maputo', JP: 'Asia/Tokyo', AU: 'Australia/Sydney',
}

const CURRENCY_TZ: Record<string, string> = { BRL: 'America/Sao_Paulo', EUR: 'Europe/Lisbon', MXN: 'America/Mexico_City' }

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Restaurants have no time-zone setting, so it is inferred from the profile:
 * state/province first (US, BR, CA span several zones), then country, then
 * currency. Returns null when nothing fits — the assistant then says it can't
 * tell whether the restaurant is open, rather than guessing.
 */
export function resolveTimeZone(p: { country?: string | null; region?: string | null; currency?: string | null }): string | null {
  const country = p.country?.trim().toUpperCase() || null
  const region = p.region?.trim().toUpperCase() || null
  let tz: string | null = null
  if (country === 'US' && region && US_STATE_TZ[region]) tz = US_STATE_TZ[region]
  else if (country === 'BR') tz = (region && BR_STATE_TZ[region]) || COUNTRY_TZ.BR
  else if (country === 'CA' && region && CA_PROVINCE_TZ[region]) tz = CA_PROVINCE_TZ[region]
  else if (country && COUNTRY_TZ[country] && country !== 'US') tz = COUNTRY_TZ[country]
  else if (!country && p.currency && CURRENCY_TZ[p.currency.toUpperCase()]) tz = CURRENCY_TZ[p.currency.toUpperCase()]
  return tz && isValidTimeZone(tz) ? tz : null
}

// ── Opening hours ──────────────────────────────────────────────────────────

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
type DayKey = (typeof DAY_KEYS)[number]
const DAY_NAMES: Record<DayKey, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
}

/** [startMinute, endMinute) from the start of the day; an end past 1440 runs into the next day. */
export type TimeRange = [number, number]

const TIME = String.raw`(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|h)?`
const RANGE = new RegExp(String.raw`^${TIME}\s*(?:-|–|—|to|até|ate|às|as|a)\s*${TIME}$`, 'i')
const CLOSED = /^(closed|fechado|cerrado|fermé|ferme|chiuso)$/i

function toMinutes(h: string, m: string | undefined, suffix: string | undefined): number | null {
  let hour = Number(h)
  const minute = m ? Number(m) : 0
  const s = suffix?.toLowerCase().replace(/\./g, '')
  if (s === 'am' || s === 'pm') {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (s === 'pm' ? 12 : 0)
  }
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return null
  return hour * 60 + minute
}

/**
 * Parses one day's free-text hours ("11:00 - 23:00", "11h às 15h, 18h às 23h",
 * "11am-10pm", "Closed"). Returns [] for a closed day and null when the text
 * isn't a time range at all ("Pickup by confirmation") — the caller then
 * passes the raw text on instead of claiming to know.
 */
export function parseDayHours(text: string | null | undefined): TimeRange[] | null {
  const raw = text?.trim()
  if (!raw) return []
  if (CLOSED.test(raw)) return []
  const ranges: TimeRange[] = []
  for (const part of raw.split(/\s*(?:,|;|\/|\be\b|\band\b|\by\b)\s*/i).filter(Boolean)) {
    const m = part.trim().match(RANGE)
    if (!m) return null
    const start = toMinutes(m[1], m[2], m[3])
    let end = toMinutes(m[4], m[5], m[6])
    if (start === null || end === null) return null
    if (end <= start) end += 1440 // crosses midnight, e.g. 18:00 - 02:00 or 11:00 - 00:00
    ranges.push([start, end])
  }
  return ranges
}

function zonedNow(now: Date, timeZone: string): { day: DayKey; minutes: number; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = get('weekday').slice(0, 3).toLowerCase() as DayKey
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  return { day, minutes: hour * 60 + minute, label: `${DAY_NAMES[day]} ${get('hour')}:${get('minute')}` }
}

function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface OpenStatus {
  status: 'open' | 'closed' | 'unknown'
  /** Local time the status was computed for, e.g. "Saturday 14:05", or null without a time zone. */
  localTime: string | null
  detail: string
}

/**
 * The open/closed state as data, for callers that word it themselves (the
 * public menu shows it in the guest's language). Minutes are after local
 * midnight; `inDays` 0 = today, 1 = tomorrow; `dayIndex` 0 = Sunday.
 */
export type OpenState =
  | { kind: 'open'; closesAt: number }
  | { kind: 'closed'; opens: { inDays: number; dayIndex: number; minutes: number } | null; nextText: { dayIndex: number; text: string } | null }
  | { kind: 'unknown'; reason: 'no-timezone' | 'no-hours' | 'free-text'; text: string | null }

export function computeOpenState(
  hours: Record<string, string | null | undefined> | null | undefined,
  now: Date,
  timeZone: string | null,
): { state: OpenState; localTime: string | null; todayIndex: number | null } {
  const hasHours = !!hours && Object.values(hours).some((v) => !!v?.trim())
  if (!timeZone) return { state: { kind: 'unknown', reason: 'no-timezone', text: null }, localTime: null, todayIndex: null }
  const { day, minutes, label } = zonedNow(now, timeZone)
  const idx = DAY_KEYS.indexOf(day)
  if (!hasHours) return { state: { kind: 'unknown', reason: 'no-hours', text: null }, localTime: label, todayIndex: idx }

  const yesterday = DAY_KEYS[(idx + 6) % 7]
  const today = parseDayHours(hours![day])
  const prev = parseDayHours(hours![yesterday])
  if (today === null) {
    return { state: { kind: 'unknown', reason: 'free-text', text: hours![day] ?? null }, localTime: label, todayIndex: idx }
  }

  const openToday = today.find(([s, e]) => minutes >= s && minutes < e)
  const openFromYesterday = prev?.find(([, e]) => e > 1440 && minutes < e - 1440)
  if (openToday) return { state: { kind: 'open', closesAt: openToday[1] % 1440 }, localTime: label, todayIndex: idx }
  if (openFromYesterday) return { state: { kind: 'open', closesAt: openFromYesterday[1] % 1440 }, localTime: label, todayIndex: idx }

  const laterToday = today.filter(([s]) => s > minutes).sort((a, b) => a[0] - b[0])[0]
  if (laterToday) {
    return { state: { kind: 'closed', opens: { inDays: 0, dayIndex: idx, minutes: laterToday[0] }, nextText: null }, localTime: label, todayIndex: idx }
  }
  for (let i = 1; i <= 7; i++) {
    const dayIndex = (idx + i) % 7
    const ranges = parseDayHours(hours![DAY_KEYS[dayIndex]])
    if (ranges === null) {
      return { state: { kind: 'closed', opens: null, nextText: { dayIndex, text: hours![DAY_KEYS[dayIndex]] ?? '' } }, localTime: label, todayIndex: idx }
    }
    if (ranges.length) {
      const first = [...ranges].sort((a, b) => a[0] - b[0])[0]
      return { state: { kind: 'closed', opens: { inDays: i, dayIndex, minutes: first[0] }, nextText: null }, localTime: label, todayIndex: idx }
    }
  }
  return { state: { kind: 'closed', opens: null, nextText: null }, localTime: label, todayIndex: idx }
}

export function computeOpenStatus(
  hours: Record<string, string | null | undefined> | null | undefined,
  now: Date,
  timeZone: string | null,
): OpenStatus {
  const { state, localTime } = computeOpenState(hours, now, timeZone)
  if (state.kind === 'unknown') {
    if (state.reason === 'no-timezone') {
      return { status: 'unknown', localTime, detail: "The restaurant's local time is unknown, so you cannot tell whether it is open now." }
    }
    if (state.reason === 'no-hours') return { status: 'unknown', localTime, detail: 'No opening hours were provided.' }
    return { status: 'unknown', localTime, detail: `Today's hours are given as "${state.text}"; answer from that text.` }
  }
  if (state.kind === 'open') return { status: 'open', localTime, detail: `Open now, closes at ${clock(state.closesAt)}.` }
  if (state.opens) {
    const when = state.opens.inDays === 0 ? 'today' : state.opens.inDays === 1 ? 'tomorrow' : DAY_NAMES[DAY_KEYS[state.opens.dayIndex]]
    return { status: 'closed', localTime, detail: `Closed now, opens ${when} at ${clock(state.opens.minutes)}.` }
  }
  if (state.nextText) {
    return { status: 'closed', localTime, detail: `Closed now. Next listed hours: ${DAY_NAMES[DAY_KEYS[state.nextText.dayIndex]]} "${state.nextText.text}".` }
  }
  return { status: 'closed', localTime, detail: 'Closed now.' }
}

// ── Profile ────────────────────────────────────────────────────────────────

export interface RestaurantProfile {
  name: string
  locationName?: string | null
  tagline?: string | null
  about?: string | null
  cuisine?: string | null
  priceRange?: string | null
  address?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  phone?: string | null
  whatsapp?: string | null
  instagram?: string | null
  hours?: Record<string, string | null | undefined> | null
  otherLocations?: Array<{ name: string; address?: string | null; city?: string | null }>
}

const MAX_ABOUT_CHARS = 800

export function describeProfile(p: RestaurantProfile, open: OpenStatus): string {
  const lines: string[] = [`- Name: ${p.name}${p.locationName ? ` — ${p.locationName} location` : ''}`]
  if (p.tagline) lines.push(`- Tagline: ${p.tagline}`)
  if (p.about) lines.push(`- About: ${p.about.slice(0, MAX_ABOUT_CHARS)}`)
  if (p.cuisine) lines.push(`- Cuisine: ${p.cuisine}`)
  if (p.priceRange) lines.push(`- Price range: ${p.priceRange}`)
  const place = [p.address, p.city, p.region, p.postalCode, p.country].filter(Boolean).join(', ')
  lines.push(`- Address: ${place || 'not provided'}`)
  lines.push(`- Phone: ${p.phone || 'not provided'}`)
  if (p.whatsapp) lines.push(`- WhatsApp: ${p.whatsapp}`)
  if (p.instagram) lines.push(`- Instagram: ${p.instagram.startsWith('@') || p.instagram.startsWith('http') ? p.instagram : `@${p.instagram}`}`)
  if (p.otherLocations?.length) {
    lines.push(`- Other locations: ${p.otherLocations.map((l) => [l.name, l.address, l.city].filter(Boolean).join(', ')).join(' | ')}`)
  }

  const days = DAY_KEYS.slice(1).concat('sun') // Monday first
  const hasHours = !!p.hours && Object.values(p.hours).some((v) => !!v?.trim())
  lines.push('\nOPENING HOURS:')
  if (hasHours) {
    for (const d of days) lines.push(`- ${DAY_NAMES[d]}: ${p.hours![d]?.trim() || 'closed'}`)
  } else {
    lines.push('- Not provided. If asked, tell the customer to check with the restaurant.')
  }
  lines.push(`- Right now${open.localTime ? ` (${open.localTime} local time)` : ''}: ${open.detail}`)
  if (open.status === 'closed') {
    lines.push('- Because the restaurant is closed now, mention it whenever the customer wants to order, and say when it opens.')
  }
  return lines.join('\n')
}
