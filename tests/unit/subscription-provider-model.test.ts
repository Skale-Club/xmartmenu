import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { parseCheckout, parsePlanSubscription } from '@/lib/billing/subscription-provider-model'
import { planChangeBody, PlanChangeError } from '@/lib/billing/plan-change-model'
import { validateSubscriptionPatch } from '@/lib/data/subscription-billing'
const tenant = randomUUID(), plan = randomUUID(), context = { accountId: 'acct_fixture', livemode: false, apiVersion: '2026-04-22.dahlia' }
const metadata = { kind: 'plan', tenant_id: tenant, plan_id: plan }
const body = { mode: 'subscription', customer: 'cus_fixture', line_items: [{ price: 'price_target', quantity: 1 }], metadata }
const session = { id: 'cs_fixture', object: 'checkout.session', mode: 'subscription', status: 'open', customer: 'cus_fixture', subscription: null, livemode: false, metadata, line_items: { data: [{ price: { id: 'price_target' }, quantity: 1 }], has_more: false }, url: 'https://checkout.stripe.com/c/pay/fixture' }
it('checkout facts require exact mode, tenant, plan, customer, line item and genuine HTTPS URL', () => {
  expect(parseCheckout(session, body, context, session.id)).toMatchObject({ id: session.id, status: 'open', url: session.url })
  for (const patch of [{ id: 'cs_other' }, { mode: 'payment' }, { livemode: true }, { customer: 'cus_other' }, { metadata: { ...metadata, tenant_id: randomUUID() } }, { line_items: { data: [{ price: { id: 'price_other' }, quantity: 1 }] } }, { url: 'javascript:alert(1)' }]) {
    expect(() => parseCheckout({ ...session, ...patch }, body, context, session.id)).toThrow()
  }
})
it('closed sessions preserve actual provider references, including expanded customer/subscription', () => {
  expect(parseCheckout({ ...session, status: 'complete', customer: { id: 'cus_fixture' }, subscription: { id: 'sub_fixture' }, url: null }, body, context, session.id)).toMatchObject({ status: 'complete', customerId: 'cus_fixture', subscriptionId: 'sub_fixture', url: null })
  expect(() => parseCheckout({ ...session, status: 'complete', url: null }, body, context, session.id)).toThrow()
})
it('subscription reads preserve ended statuses and reject foreign metadata/customer or provider mode', () => {
  const value = { id: 'sub_fixture', object: 'subscription', status: 'active', livemode: false, metadata, customer: 'cus_fixture', latest_invoice: null, items: { data: [{ id: 'si_fixture', price: { id: 'price_previous' } }], has_more: false } }
  const expected = { id: value.id, tenantId: tenant, customerId: 'cus_fixture', context }
  expect(parsePlanSubscription(value, expected)?.items.data[0].price.id).toBe('price_previous')
  expect(parsePlanSubscription({ ...value, status: 'canceled' }, expected)).toBeNull()
  expect(() => parsePlanSubscription({ ...value, metadata: { ...metadata, tenant_id: randomUUID() } }, expected)).toThrow()
  expect(() => parsePlanSubscription({ ...value, livemode: true }, expected)).toThrow()
})
it('shared plan-change decision checks dunning before no-op and freezes proration time only for native requests', () => {
  const price = { id: plan, stripe_price_monthly_id: 'price_target', stripe_price_annual_id: 'price_year' }, subscription = { status: 'active', items: { data: [{ id: 'si_fixture', price: { id: 'price_target' } }] } }
  expect(planChangeBody({ subscription, tenantId: tenant, plan: price, cycle: 'monthly' })).toBeNull()
  expect(() => planChangeBody({ subscription: { ...subscription, status: 'past_due' }, tenantId: tenant, plan: price, cycle: 'monthly' })).toThrow(PlanChangeError)
  const common = { subscription, tenantId: tenant, plan: price, cycle: 'annual' as const }
  expect(planChangeBody(common)).not.toHaveProperty('proration_date')
  expect(planChangeBody({ ...common, prorationDate: 1000 })).toMatchObject({ proration_date: 1000, proration_behavior: 'create_prorations', payment_behavior: 'error_if_incomplete', items: [{ id: 'si_fixture', price: 'price_year' }], metadata })
})
it('override validation preserves zero/null and never forwards unknown mutation columns', () => {
  expect(validateSubscriptionPatch({ override_monthly_price: 0, override_notes: null, tenant_id: randomUUID(), stripe_subscription_id: 'sub_forged' })).toEqual({ override_monthly_price: 0, override_notes: null })
  expect(() => validateSubscriptionPatch({ override_annual_price: Number.NaN })).toThrow()
  expect(() => validateSubscriptionPatch({ override_transaction_fee_pct: 101 })).toThrow()
})
