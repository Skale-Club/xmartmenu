import { createHash } from 'node:crypto'
import { AdminMenuError } from '../data/admin-menus'
import { invoiceAmountMinor } from './billing-rules'
import { usageLineDescription } from './billing-description'

export interface BillingProviderContext { accountId: string; livemode: boolean; apiVersion: string }
export interface BillingRequestBody { customer: string; invoice?: string; amount: number; currency: string; description: string; metadata: Record<string, string> }
export interface BillingUsage { id: string; cost_usd: string; charge_usd: string }
export const BILLING_RETRY_WINDOW_MS = 20 * 60 * 60 * 1000
export const BILLING_LEASE_MS = 30000
export const unavailable = () => new AdminMenuError(503, 'AI billing requires reconciliation')
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,255}$/.test(value)
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  const result = JSON.stringify(value)
  if (result === undefined) throw unavailable()
  return result
}
export const hashFacts = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex')
export function validContext(value: BillingProviderContext) {
  if (!validId(value.accountId) || typeof value.livemode !== 'boolean' || !validId(value.apiVersion.replaceAll('.', '-'))) throw unavailable()
  return value
}
export function usageFacts(rows: BillingUsage[]) {
  if (!rows.length || rows.length > 50000) throw unavailable()
  let costUsd = 0, chargeUsd = 0, last = BigInt(0)
  for (const row of rows) {
    if (!/^[1-9][0-9]*$/.test(row.id) || BigInt(row.id) <= last) throw unavailable()
    last = BigInt(row.id)
    const cost = Number(row.cost_usd), charge = Number(row.charge_usd)
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(charge) || charge < 0) throw unavailable()
    costUsd += cost; chargeUsd += charge
  }
  if (!Number.isFinite(costUsd) || !Number.isFinite(chargeUsd)) throw unavailable()
  return { events: rows.length, costUsd, chargeUsd, maxEventId: String(last), usageDigest: hashFacts(rows) }
}
export function makeBillingBody(input: { tenantId: string; batchId: string; customer: string; invoice?: string; currency: string; now: Date; usdToBrl: number }, facts: ReturnType<typeof usageFacts>): BillingRequestBody {
  if (!validId(input.customer) || (input.invoice !== undefined && !validId(input.invoice)) || !/^[a-z]{3}$/.test(input.currency) || !Number.isFinite(input.now.getTime()) || !Number.isFinite(input.usdToBrl) || input.usdToBrl <= 0 || input.usdToBrl > 100) throw unavailable()
  const amount = invoiceAmountMinor(facts.chargeUsd, input.currency, input.usdToBrl)
  if (!Number.isSafeInteger(amount) || amount < 0) throw unavailable()
  return { customer: input.customer, ...(input.invoice ? { invoice: input.invoice } : {}), amount, currency: input.currency,
    description: usageLineDescription({ ...facts, amountMinor: amount, currency: input.currency, until: input.now }),
    metadata: { kind: 'ai_usage', tenant_id: input.tenantId, events: String(facts.events), cost_usd: facts.costUsd.toFixed(8), charge_usd: facts.chargeUsd.toFixed(8), usd_to_brl: String(input.usdToBrl), last_event_id: facts.maxEventId, billing_batch: input.batchId } }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
const reference = (value: unknown) => typeof value === 'string' ? value : object(value).id
export function matchesBillingItem(input: unknown, body: BillingRequestBody, context: BillingProviderContext): input is { id: string } {
  const item = object(input), metadata = object(item.metadata)
  return validId(item.id) && item.object === 'invoiceitem' && item.deleted !== true && item.livemode === context.livemode
    && reference(item.customer) === body.customer && reference(item.invoice) === (body.invoice ?? undefined)
    && item.amount === body.amount && item.currency === body.currency && item.description === body.description
    && Object.keys(body.metadata).every(key => metadata[key] === body.metadata[key])
}
