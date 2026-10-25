/**
 * Who pays for each AI call, and how much we charge (pure — tested in
 * tests/unit/ai/billing-rules.test.ts; server wiring in ./access.ts).
 *
 * Per client (tenant_ai_settings, default in platform_ai_settings):
 *   own_key   their OpenRouter key: they pay OpenRouter directly. If it fails
 *             (no credit, revoked), fall back to our global key — billed.
 *   platform  our global key, billed to them: real cost + margin.
 *   included  our global key, not billed.
 * Work we do for the client from the superadmin (seed, OCR, images) uses the
 * global key and is never billed — it is recorded as our own cost.
 */

export type AiBillingMode = 'own_key' | 'platform' | 'included'
export const AI_BILLING_MODES: readonly AiBillingMode[] = ['own_key', 'platform', 'included']

/** What the call is for: tenant features follow the client's mode. */
export type AiFeature =
  | 'chat'
  | 'transcription'
  | 'translation'
  | 'blog'
  | 'seed'
  | 'ocr'
  | 'seed_image'

const PLATFORM_SERVICE: ReadonlySet<AiFeature> = new Set(['seed', 'ocr', 'seed_image'])

export interface KeyChoice {
  apiKey: string
  keySource: 'tenant' | 'platform'
  billable: boolean
  markupPct: number
}

export interface AiAccessPlan {
  primary: KeyChoice
  /** Used when the primary (client) key is rejected. */
  fallback: KeyChoice | null
}

export function parseBillingMode(value: unknown): AiBillingMode | null {
  return typeof value === 'string' && (AI_BILLING_MODES as readonly string[]).includes(value) ? (value as AiBillingMode) : null
}

/** null = no key can serve this call (AI unavailable). */
export function planAiAccess(input: {
  feature: AiFeature
  /** null for the platform's own features (platform blog). */
  tenantId: string | null
  tenantMode: AiBillingMode | null
  tenantKey: string | null
  tenantMarkupPct: number | null
  platformKey: string | null
  defaultMode: AiBillingMode
  defaultMarkupPct: number
}): AiAccessPlan | null {
  const markup = clampMarkup(input.tenantMarkupPct ?? input.defaultMarkupPct)
  const platform = (billable: boolean): KeyChoice | null =>
    input.platformKey ? { apiKey: input.platformKey, keySource: 'platform', billable, markupPct: billable ? markup : 0 } : null

  if (!input.tenantId || PLATFORM_SERVICE.has(input.feature)) {
    const choice = platform(false)
    return choice ? { primary: choice, fallback: null } : null
  }

  const mode = input.tenantMode ?? input.defaultMode
  if (mode === 'included') {
    const choice = platform(false)
    return choice ? { primary: choice, fallback: null } : null
  }
  if (mode === 'own_key' && input.tenantKey) {
    return {
      primary: { apiKey: input.tenantKey, keySource: 'tenant', billable: false, markupPct: 0 },
      fallback: platform(true),
    }
  }
  // platform mode, or own_key without a key yet: our key, billed.
  const choice = platform(true)
  return choice ? { primary: choice, fallback: null } : null
}

export function clampMarkup(value: number): number {
  return Number.isFinite(value) ? Math.min(1000, Math.max(0, value)) : 0
}

/** What we charge for one call, in USD: real cost + margin. */
export function chargeFor(costUsd: number, billable: boolean, markupPct: number): number {
  if (!billable || !(costUsd > 0)) return 0
  return round8(costUsd * (1 + clampMarkup(markupPct) / 100))
}

/**
 * HTTP statuses that mean "this key can't pay for the call" — the client's
 * key is invalid, out of credit or disabled — so the global key takes over.
 */
export function isKeyRejection(status: number | null | undefined): boolean {
  return status === 401 || status === 402 || status === 403
}

/** Amount for the Stripe invoice line, in the invoice currency's minor unit. */
export function invoiceAmountMinor(chargeUsd: number, currency: string, usdToBrl: number): number {
  const amount = currency.toLowerCase() === 'brl' ? chargeUsd * usdToBrl : chargeUsd
  return Math.round(amount * 100)
}

const round8 = (n: number) => Math.round(n * 1e8) / 1e8
