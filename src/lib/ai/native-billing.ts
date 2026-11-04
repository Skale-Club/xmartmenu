import { stripe } from '../stripe'
import { ownedAiBillingRepository } from '../data/ai-billing-runtime'
import type { BillingPreparation, NativeBillingOptions, NativeBillingRequest } from '../data/ai-billing'
import { matchesBillingItem, unavailable, validContext, type BillingProviderContext, type BillingRequestBody } from './native-billing-facts'
import type { BillResult } from './billing'

export const NATIVE_BILLING_PROVIDER_OPTIONS = Object.freeze({ timeout: 6000, maxNetworkRetries: 0, apiVersion: '2026-04-22.dahlia' })
export interface NativeBillingRepository {
  prepare(options: NativeBillingOptions, context?: BillingProviderContext): Promise<BillingPreparation>
  claim(request: NativeBillingRequest, context: BillingProviderContext, now: Date): Promise<{ request: NativeBillingRequest; token: string } | null>
  refuse(request: NativeBillingRequest, token: string): Promise<void>
  finalize(request: NativeBillingRequest, token: string, item: unknown, options: NativeBillingOptions, now: Date): Promise<BillResult>
}
export interface NativeBillingGateway {
  context(options: typeof NATIVE_BILLING_PROVIDER_OPTIONS): Promise<BillingProviderContext>
  create(body: BillingRequestBody, options: typeof NATIVE_BILLING_PROVIDER_OPTIONS & { idempotencyKey: string }): Promise<unknown>
}
const gateway: NativeBillingGateway = {
  async context(options) {
    const [account, balance] = await Promise.all([stripe.accounts.retrieve(null, {}, options), stripe.balance.retrieve({}, options)])
    return validContext({ accountId: account.id, livemode: balance.livemode, apiVersion: options.apiVersion })
  },
  create: (body, options) => stripe.invoiceItems.create(body, options),
}

/** No SQL connection remains held while reading/calling Stripe. Never retry SQL. */
export async function runNativeAiBilling(options: NativeBillingOptions, repository: NativeBillingRepository, provider: NativeBillingGateway, clock = () => new Date()): Promise<{ result: BillResult; skipped?: true }> {
  let prepared = await repository.prepare(options)
  if (prepared.kind === 'done') return prepared
  let context: BillingProviderContext
  try { context = validContext(await provider.context(NATIVE_BILLING_PROVIDER_OPTIONS)) } catch { throw unavailable() }
  if (prepared.kind === 'context') prepared = await repository.prepare(options, context)
  if (prepared.kind === 'done') return prepared
  if (prepared.kind !== 'request') throw unavailable()
  const claimed = await repository.claim(prepared.request, context, clock())
  if (!claimed) throw unavailable()
  let item: unknown
  try { item = await provider.create(claimed.request.body, { ...NATIVE_BILLING_PROVIDER_OPTIONS, idempotencyKey: `ai-usage-batch-${claimed.request.batchId}` }) }
  catch {
    // An SDK error does not prove non-delivery. Keep the durable facts and
    // refuse another automatic charge; failure to persist also fails closed.
    await repository.refuse(claimed.request, claimed.token)
    throw unavailable()
  }
  if (!matchesBillingItem(item, claimed.request.body, claimed.request.context)) {
    await repository.refuse(claimed.request, claimed.token)
    throw unavailable()
  }
  return { result: await repository.finalize(claimed.request, claimed.token, item, options, clock()) }
}
export const billOwnedAiUsage = (options: NativeBillingOptions) => runNativeAiBilling(options, ownedAiBillingRepository, gateway)
