import type Stripe from 'stripe'
import { stripe } from '../stripe'
import { validContext, type BillingProviderContext } from '../ai/native-billing-facts'
import type { ProviderObject } from './subscription-provider-model'

export interface SubscriptionGateway {
  context(): Promise<BillingProviderContext>
  subscription(id: string): Promise<unknown>
  checkout(id: string): Promise<unknown>
  createCheckout(body: ProviderObject, key: string): Promise<unknown>
  updateSubscription(id: string, body: ProviderObject, key: string): Promise<unknown>
  expireCheckout(id: string, key: string): Promise<unknown>
  portal(customerId: string, returnUrl: string): Promise<unknown>
}
export const SUBSCRIPTION_PROVIDER_OPTIONS = Object.freeze({ timeout: 6000, maxNetworkRetries: 0, apiVersion: '2026-04-22.dahlia' })
export const subscriptionGateway: SubscriptionGateway = {
  async context() {
    const [account, balance] = await Promise.all([stripe.accounts.retrieve(null, {}, SUBSCRIPTION_PROVIDER_OPTIONS), stripe.balance.retrieve({}, SUBSCRIPTION_PROVIDER_OPTIONS)])
    return validContext({ accountId: account.id, livemode: balance.livemode, apiVersion: SUBSCRIPTION_PROVIDER_OPTIONS.apiVersion })
  },
  subscription: id => stripe.subscriptions.retrieve(id, {}, SUBSCRIPTION_PROVIDER_OPTIONS),
  checkout: id => stripe.checkout.sessions.retrieve(id, { expand: ['line_items.data.price'] }, SUBSCRIPTION_PROVIDER_OPTIONS),
  createCheckout: (body, key) => stripe.checkout.sessions.create(body as unknown as Stripe.Checkout.SessionCreateParams, { ...SUBSCRIPTION_PROVIDER_OPTIONS, idempotencyKey: key }),
  updateSubscription: (id, body, key) => stripe.subscriptions.update(id, body as Stripe.SubscriptionUpdateParams, { ...SUBSCRIPTION_PROVIDER_OPTIONS, idempotencyKey: key }),
  expireCheckout: (id, key) => stripe.checkout.sessions.expire(id, {}, { ...SUBSCRIPTION_PROVIDER_OPTIONS, idempotencyKey: key }),
  portal: (customerId, returnUrl) => stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl }, SUBSCRIPTION_PROVIDER_OPTIONS),
}
