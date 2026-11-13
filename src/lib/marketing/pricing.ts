/**
 * Single source of truth for the public pricing page (USD).
 * Every number shown on /pricing and in the homepage teaser/FAQ is read from
 * here. "3D" is the customer-facing name for the dish viewer: never say AR.
 */

export const CURRENCY = 'USD'
export const LAUNCH_SLOTS = 20
export const LAUNCH_ENDS = 'March 31, 2027'
export const PRICING_CTA_HREF = '/auth/register'
export const PRICING_PATH = '/pricing'
export const NFC_NOTE = 'NFC Stands and NFC Plates for your tables are sold separately.'

export interface PricePair { launch: number; list: number }

export const PROJECTS = {
  diy: { launch: 290, list: 490 },
  we: { launch: 590, list: 990, includedItems: 20, extraItem: { launch: 9, list: 19 } },
  threeD: {
    launch: 1190, list: 2490, includedItems: 20,
    extraItemWith3D: { launch: 39, list: 99 },
    extraItemWithout3D: 9,
  },
} as const

export type PlanKey = 'menu' | 'waiter' | 'payments'

export const PLANS: Record<PlanKey, { monthly: number; yearly: number; paymentFeePercent?: number }> = {
  menu: { monthly: 99, yearly: 990 },
  waiter: { monthly: 179, yearly: 1790 },
  payments: { monthly: 249, yearly: 2490, paymentFeePercent: 1 },
}

export const CHANGES_PER_MONTH = 3
export const MIN_MONTHS = 3
export const YEARLY_FREE_MONTHS = 2
export const PAYMENT_SPLIT = { start: 50, launch: 50 }

export const ADDONS = {
  extraLanguage: { launch: 90, list: 190 },
  extraItem: { launch: 9, list: 19 },
  photoTouchUp: { launch: 5, list: 9 },
  threeDDish: {
    launch: 39, list: 99,
    from10Each: 34.9, from10Total: 349,
    from20Each: 30,
  },
  threeDDrink: { launch: 59, list: 149 },
  redoThreeDPercent: 50,
  extraChange: { launch: 15, list: 25 },
  aiChat: { monthly: 29 },
  growth: { monthly: 99, listMonthly: 149 },
  extraLocation: { monthly: 79, listMonthly: 99 },
} as const

export const THREE_D_TIER_10 = 10
export const THREE_D_TIER_20 = 20

export const MAX_ITEMS = 400
export const MAX_LANGUAGES = 10

const money = (n: number, decimals = false): string =>
  '$' + n.toLocaleString('en-US', decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })

/** "$34.90" for fractional amounts, "$39" for whole ones. */
export function formatUsd(n: number): string {
  return money(n, !Number.isInteger(n))
}

/** Cost of n 3D dishes with volume tiers. */
export function threeDCost(n: number): number {
  const count = Math.max(0, Math.floor(n))
  const d = ADDONS.threeDDish
  const each = count >= THREE_D_TIER_20 ? d.from20Each : count >= THREE_D_TIER_10 ? d.from10Each : d.launch
  return Math.round(each * count * 100) / 100
}

export type EstimateMode = 'diy' | 'we'

export interface EstimateInput {
  mode: EstimateMode
  items: number
  threeDDishes: number
  extraLanguages: number
  /** Only counted in 'diy' mode. */
  photos?: number
  plan?: PlanKey
}

export interface Estimate {
  base: number
  extraItems: number
  threeD: number
  languages: number
  photoTouchUps: number
  project: number
  monthly: number
  firstYear: number
  paymentFeePercent: number
  threeDCount: number
}

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? Math.floor(v) : lo))

export function estimateProject(input: EstimateInput): Estimate {
  const items = clampInt(input.items, 0, MAX_ITEMS)
  const threeDCount = clampInt(input.threeDDishes, 0, items)
  const langs = clampInt(input.extraLanguages, 0, MAX_LANGUAGES)
  const photos = input.mode === 'diy' ? clampInt(input.photos ?? 0, 0, 5000) : 0

  const base = input.mode === 'diy' ? PROJECTS.diy.launch : PROJECTS.we.launch
  const extraItems = input.mode === 'we'
    ? Math.max(0, items - PROJECTS.we.includedItems) * PROJECTS.we.extraItem.launch
    : 0
  const threeD = threeDCost(threeDCount)
  const languages = langs * ADDONS.extraLanguage.launch
  const photoTouchUps = photos * ADDONS.photoTouchUp.launch
  const project = Math.round((base + extraItems + threeD + languages + photoTouchUps) * 100) / 100

  const plan = PLANS[input.plan ?? 'waiter']
  return {
    base, extraItems, threeD, languages, photoTouchUps, project,
    monthly: plan.monthly,
    firstYear: Math.round((project + plan.monthly * 11) * 100) / 100,
    paymentFeePercent: plan.paymentFeePercent ?? 0,
    threeDCount,
  }
}
