import { billingUnavailable, providerId } from '../data/subscription-billing'
import type { BillingProviderContext } from '../ai/native-billing-facts'
import { endedSubscription } from './plan-change-model'

export type ProviderObject = Record<string, unknown>
export const record = (value: unknown): ProviderObject => value && typeof value === 'object' && !Array.isArray(value) ? value as ProviderObject : {}
export function providerReference(value: unknown): string | null { const id = typeof value === 'string' ? value : record(value).id; if (id == null) return null; if (!providerId(id)) throw billingUnavailable(); return id }
export interface PlanSubscriptionFacts {
  id: string; status: string; customerId: string; livemode: boolean; latestInvoiceId: string | null
  items: { data: Array<{ id: string; price: { id: string } }> }
}
export function parsePlanSubscription(input: unknown, expected: { id: string; tenantId: string; customerId: string | null; context: BillingProviderContext }): PlanSubscriptionFacts | null {
  const value = record(input), metadata = record(value.metadata)
  if (value.id !== expected.id || value.object !== 'subscription' || value.livemode !== expected.context.livemode || typeof value.status !== 'string') throw billingUnavailable()
  const customerId = providerReference(value.customer)
  if (!customerId || (expected.customerId && customerId !== expected.customerId) || (metadata.tenant_id != null && metadata.tenant_id !== expected.tenantId) || (metadata.kind != null && metadata.kind !== 'plan')) throw billingUnavailable()
  if (!expected.customerId && metadata.tenant_id !== expected.tenantId) throw billingUnavailable()
  if (endedSubscription(value.status)) return null
  const source = record(value.items), rows = source.data
  if (!Array.isArray(rows) || source.has_more === true) throw billingUnavailable()
  const items = rows.map(row => { const item = record(row), price = providerReference(item.price); if (!providerId(item.id) || !price) throw billingUnavailable(); return { id: item.id, price: { id: price } } })
  return { id: expected.id, status: value.status, customerId, livemode: value.livemode as boolean, latestInvoiceId: providerReference(value.latest_invoice), items: { data: items } }
}
export interface CheckoutFacts { id: string; status: 'open' | 'complete' | 'expired'; customerId: string | null; subscriptionId: string | null; url: string | null }
export function parseCheckout(input: unknown, body: ProviderObject, context: BillingProviderContext, expectedId?: string): CheckoutFacts {
  const value = record(input), metadata = record(value.metadata), expected = record(body.metadata)
  if (!providerId(value.id) || (expectedId && value.id !== expectedId) || value.object !== 'checkout.session' || value.mode !== 'subscription' || value.livemode !== context.livemode
    || !['open','complete','expired'].includes(String(value.status)) || metadata.kind !== 'plan' || metadata.tenant_id !== expected.tenant_id || metadata.plan_id !== expected.plan_id) throw billingUnavailable()
  const customerId = providerReference(value.customer), subscriptionId = providerReference(value.subscription)
  if (body.customer && customerId !== body.customer) throw billingUnavailable()
  const requested = body.line_items, returned = record(value.line_items)
  if (!Array.isArray(requested) || requested.length !== 1 || !Array.isArray(returned.data) || returned.data.length !== 1 || returned.has_more === true) throw billingUnavailable()
  const line = record(returned.data[0])
  if (providerReference(line.price) !== record(requested[0]).price || line.quantity !== 1) throw billingUnavailable()
  let url: string | null = null
  if (typeof value.url === 'string') { const parsed = new URL(value.url); if (parsed.protocol !== 'https:') throw billingUnavailable(); url = parsed.href }
  if (value.status === 'open' && !url) throw billingUnavailable()
  if (value.status === 'complete' && !subscriptionId) throw billingUnavailable()
  return { id: value.id, status: value.status as CheckoutFacts['status'], customerId, subscriptionId, url }
}
