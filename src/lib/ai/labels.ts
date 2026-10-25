/**
 * Panel wording for AI billing (client-safe: no server imports).
 */
import type { AiBillingMode } from './billing-rules'

export const BILLING_MODE_LABELS: Record<AiBillingMode, string> = {
  own_key: "Client's own OpenRouter key",
  platform: 'Platform key, billed with margin',
  included: 'Platform key, included (not billed)',
}

export const BILLING_MODE_HELP: Record<AiBillingMode, string> = {
  own_key: 'The client pays OpenRouter directly. If their key is rejected (invalid or out of credit), the platform key takes over and those calls are billed with margin.',
  platform: 'Calls run on the platform key. Real cost plus margin goes on the monthly plan invoice.',
  included: 'Calls run on the platform key and are not billed (courtesy or bundled in the plan).',
}

export const BILLING_MODES: AiBillingMode[] = ['own_key', 'platform', 'included']

export function formatUsd(value: number | null | undefined, digits = 4): string {
  return `US$ ${(value ?? 0).toFixed(digits)}`
}

export function formatBrl(usd: number | null | undefined, usdToBrl: number): string {
  return ((usd ?? 0) * usdToBrl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export interface UsageMonth {
  calls: number
  costUsd: number
  chargeUsd: number
  unbilledChargeUsd: number
  byKey: { tenant: number; platform: number }
}

export interface KeyCheckResult {
  ok: boolean
  status?: number
  label?: string | null
  limitRemaining?: number | null
  error?: string
}

export function keyCheckMessage(check: KeyCheckResult): string {
  if (!check.ok) return check.error ?? `OpenRouter answered ${check.status ?? 'an error'}`
  const parts = ['Key works']
  if (check.label) parts.push(`label "${check.label}"`)
  if (check.limitRemaining != null) parts.push(`US$ ${check.limitRemaining.toFixed(2)} left on its limit`)
  return parts.join(' · ')
}
