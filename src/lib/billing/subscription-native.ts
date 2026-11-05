import type { AdminMenuQuery } from '../data/admin-menus'
import { AdminMenuError } from '../data/admin-menus'
import { hashFacts, validContext, type BillingProviderContext } from '../ai/native-billing-facts'
import { billingUnavailable, ensureCheckoutSubscription, providerId, readBillingPlan, subscriptionSnapshot, validateSubscriptionPatch, writeSubscriptionPatch, type SubscriptionActor, type SubscriptionPatch, type SubscriptionRecord } from '../data/subscription-billing'
import { claimSubscriptionRequest, closeObservedCheckout, finishSubscriptionRequest, prepareSubscriptionRequest, readCompletedSubscriptionCheckout, readOpenSubscriptionCheckout, readPendingSubscriptionRequest, refuseSubscriptionRequest, type SubscriptionRequest } from '../data/subscription-requests'
import { planChangeBody, PlanChangeError, priceIdForCycle, type BillingCycle } from './plan-change-model'
import { parseCheckout, parsePlanSubscription, providerReference, record, type ProviderObject } from './subscription-provider-model'
import type { SubscriptionGateway } from './subscription-provider'

export interface SubscriptionTransactions { run<T>(write: boolean, operation: (query: AdminMenuQuery) => Promise<T>): Promise<T> }
export interface SubscriptionInput { mode: 'checkout' | 'cycle' | 'admin'; planId?: string; cycle?: BillingCycle; patch?: SubscriptionPatch }
export interface SubscriptionDependencies { database: SubscriptionTransactions; gateway: SubscriptionGateway; baseUrl: string; clock?: () => Date }
const warning = 'This restaurant is still billed through Stripe: the status set here is overwritten by the next Stripe event. Cancel or pause the subscription in Stripe to make it stick.'
const now = (deps: SubscriptionDependencies) => (deps.clock ?? (() => new Date()))()
const baseline = (value: SubscriptionRecord | null) => ({ id: value?.id ?? null, planId: value?.planId ?? null, cycle: value?.cycle ?? null, customerId: value?.customerId ?? null, subscriptionId: value?.subscriptionId ?? null })
const sessionResult = (value: { status: string; customerId: string | null; subscriptionId: string | null }) => ({ status: value.status, customerId: value.customerId, subscriptionId: value.subscriptionId })
function checkIntent(request: SubscriptionRequest, input: SubscriptionInput) {
  const target = record(request.facts.targetPlan)
  if (request.facts.mode !== input.mode || (input.planId && input.planId !== target.id) || (input.cycle && input.cycle !== request.facts.cycle)
    || (input.mode === 'admin' && hashFacts(input.patch ?? {}) !== hashFacts(request.facts.localPatch ?? {}))) throw new AdminMenuError(409, 'Another billing change is already in progress')
}
async function liveSubscription(deps: SubscriptionDependencies, id: string, tenantId: string, customerId: string | null, context: BillingProviderContext) {
  let value: unknown
  try { value = await deps.gateway.subscription(id) }
  catch (error) { if (record(error).code === 'resource_missing') return null; throw new PlanChangeError('Could not reach Stripe. Try again in a moment.', 502) }
  return parsePlanSubscription(value, { id, tenantId, customerId, context })
}
async function executeRequest(context: SubscriptionActor, frozen: SubscriptionRequest, provider: BillingProviderContext, deps: SubscriptionDependencies) {
  const claimed = await deps.database.run(true, query => claimSubscriptionRequest(query, context, frozen, provider, now(deps)))
  if (!claimed) throw billingUnavailable()
  const key = `xmartmenu-subscription-${claimed.id}`
  let response: unknown
  try {
    if (claimed.operation === 'checkout') response = await deps.gateway.createCheckout(claimed.body, key)
    else if (claimed.operation === 'plan_change') response = await deps.gateway.updateSubscription(String(claimed.facts.providerSubscriptionId), claimed.body, key)
    else response = await deps.gateway.expireCheckout(String(claimed.facts.sessionId), key)
  } catch (error) {
    if (claimed.operation === 'expire_checkout') {
      // Only this non-charge operation has a closed-state read proof. A
      // completed/expired session cannot be expired again or opened twice.
      try {
        const observed = parseCheckout(await deps.gateway.checkout(String(claimed.facts.sessionId)), record(claimed.facts.checkoutBody), provider, String(claimed.facts.sessionId))
        if (observed.status !== 'open') {
          await deps.database.run(true, query => finishSubscriptionRequest(query, context, claimed, observed.id, sessionResult(observed), undefined, now(deps)))
          return { kind: 'closed' as const, session: observed }
        }
      } catch { /* The original outcome is still uncertain. */ }
    }
    const declined = claimed.operation === 'plan_change' && record(error).type === 'StripeCardError'
    await deps.database.run(true, query => refuseSubscriptionRequest(query, context, claimed, declined))
    if (declined) throw new PlanChangeError(typeof record(error).message === 'string' ? String(record(error).message) : 'The card was declined. Update it in the billing portal and try again.', 402)
    throw new PlanChangeError('Stripe billing requires reconciliation before another attempt.', 502)
  }
  try {
    if (claimed.operation === 'checkout') {
      const returnedId = providerReference(record(response).id)
      if (!returnedId) throw billingUnavailable()
      // Creation responses do not expand line_items. A bounded authoritative
      // read validates actual session facts and catches completion races.
      const session = parseCheckout(await deps.gateway.checkout(returnedId), claimed.body, provider, returnedId)
      await deps.database.run(true, query => finishSubscriptionRequest(query, context, claimed, session.id, { status: session.status, customerId: session.customerId, subscriptionId: session.subscriptionId }, undefined, now(deps)))
      if (session.status === 'open') return { kind: 'checkout' as const, session }
      await deps.database.run(true, query => closeObservedCheckout(query, context, { ...claimed, objectId: session.id }, sessionResult(session)))
      return { kind: 'closed' as const, session }
    }
    if (claimed.operation === 'expire_checkout') {
      const session = parseCheckout(await deps.gateway.checkout(String(claimed.facts.sessionId)), record(claimed.facts.checkoutBody), provider, String(claimed.facts.sessionId))
      if (session.status === 'open') throw billingUnavailable()
      await deps.database.run(true, query => finishSubscriptionRequest(query, context, claimed, session.id, sessionResult(session), undefined, now(deps)))
      return { kind: 'closed' as const, session }
    }
    const target = record(claimed.facts.targetPlan), subscriptionId = String(claimed.facts.providerSubscriptionId)
    const subscription = parsePlanSubscription(response, { id: subscriptionId, tenantId: context.tenantId, customerId: String(claimed.facts.providerCustomerId), context: provider })
    const metadata = record(record(response).metadata), items = claimed.body.items
    if (!subscription || !Array.isArray(items) || subscription.items.data[0]?.price.id !== record(items[0]).price || metadata.kind !== 'plan' || metadata.tenant_id !== context.tenantId || metadata.plan_id !== target.id) throw billingUnavailable()
    const patch = claimed.facts.localPatch == null ? undefined : validateSubscriptionPatch(claimed.facts.localPatch)
    const result = await deps.database.run(true, query => finishSubscriptionRequest(query, context, claimed, subscriptionId, { changed: true }, patch, now(deps)))
    return { kind: 'changed' as const, result, facts: claimed.facts }
  } catch (error) {
    // If COMMIT actually completed, this conditional state-only write cannot
    // replace its receipt; if it did not, do not report success or retry blind.
    await deps.database.run(true, query => refuseSubscriptionRequest(query, context, claimed))
    throw error
  }
}
function changedResponse(context: SubscriptionActor, input: SubscriptionInput, facts: ProviderObject, result?: ProviderObject, changed = true) {
  if (input.mode === 'checkout') return { body: { updated: true, changed, plan_id: record(facts.targetPlan).id, billing_cycle: facts.cycle } }
  if (input.mode === 'cycle') return { body: { success: true, pending: true, subscription: { billing_cycle: facts.cycle } } }
  if (!result) throw billingUnavailable()
  return { body: facts.warning ? { ...result, warning } : result, sync: { tenantId: context.tenantId, reason: facts.existing ? 'plan_changed' as const : 'plan_activated' as const }, slug: String(facts.slug) }
}
async function localChange(context: SubscriptionActor, input: SubscriptionInput, initial: Awaited<ReturnType<typeof subscriptionSnapshot>>, deps: SubscriptionDependencies, warningNeeded = false) {
  const cycle = input.cycle ?? input.patch?.billing_cycle ?? initial.subscription?.cycle ?? 'monthly'
  const patch: SubscriptionPatch | undefined = input.mode === 'admin' ? input.patch : input.mode === 'cycle' ? { billing_cycle: cycle } : undefined
  if (!patch) throw billingUnavailable()
  const result = await deps.database.run(true, async query => {
    const current = await subscriptionSnapshot(query, context, true, input.mode === 'admin')
    if (hashFacts(baseline(current.subscription)) !== hashFacts(baseline(initial.subscription))) throw billingUnavailable()
    return writeSubscriptionPatch(query, context, patch, current.subscription, input.mode === 'admin')
  })
  if (input.mode === 'cycle') return { body: { success: true, subscription: { billing_cycle: cycle } } }
  return changedResponse(context, input, { warning: warningNeeded, existing: !!initial.subscription, slug: initial.slug }, result)
}
/** Financial network calls occur only between short durable SQL phases. */
export async function changeNativeSubscription(context: SubscriptionActor, input: SubscriptionInput, deps: SubscriptionDependencies): Promise<{ body: ProviderObject; sync?: { tenantId: string; reason: 'plan_changed' | 'plan_activated' }; slug?: string }> {
  if (input.mode === 'admin') input.patch = validateSubscriptionPatch(input.patch)
  let initial = await deps.database.run(true, query => subscriptionSnapshot(query, context, true, input.mode === 'admin'))
  if (input.mode === 'cycle' && !initial.subscription) throw new AdminMenuError(404, 'No subscription to update')
  const pending = await deps.database.run(false, query => readPendingSubscriptionRequest(query, context))
  let open = await deps.database.run(false, query => readOpenSubscriptionCheckout(query, context))
  const known = await deps.database.run(false, query => readCompletedSubscriptionCheckout(query, context))
  const financialIntent = input.mode === 'checkout' || (input.mode === 'cycle' && input.cycle !== initial.subscription?.cycle)
    || (input.mode === 'admin' && ((input.patch?.plan_id !== undefined && input.patch.plan_id !== initial.subscription?.planId) || (input.patch?.billing_cycle !== undefined && input.patch.billing_cycle !== initial.subscription?.cycle)))
  // Local-only billing preferences/overrides must remain usable when Stripe
  // is not configured; pending/provider-backed billing still takes priority.
  if (input.mode !== 'checkout' && !pending && !open && !known && !initial.subscription?.subscriptionId) return localChange(context, input, initial, deps)
  if (input.mode !== 'checkout' && !financialIntent && !pending && !initial.subscription?.subscriptionId) return localChange(context, input, initial, deps)
  const provider = validContext(await deps.gateway.context())
  if (pending) {
    checkIntent(pending, input)
    const recovered = await executeRequest(context, pending, provider, deps)
    if (recovered.kind === 'checkout') return { body: { url: recovered.session.url } }
    if (recovered.kind === 'changed') return changedResponse(context, input, recovered.facts, recovered.result)
    if (recovered.session.status === 'complete') throw new AdminMenuError(409, 'Checkout completed. Refresh before changing the plan.')
    open = null
  }
  let sessionSubscription: string | null = null, sessionCustomer: string | null = null
  const targetId = input.planId ?? input.patch?.plan_id ?? initial.subscription?.planId
  if (!targetId) throw new AdminMenuError(400, input.mode === 'admin' ? 'Select a plan before editing billing details.' : 'No plan specified and tenant has no current plan')
  const plan = await deps.database.run(false, query => readBillingPlan(query, targetId))
  if (!plan) throw new AdminMenuError(404, 'Plan not found')
  if ((input.planId || input.patch?.plan_id) && !plan.is_active) throw new AdminMenuError(400, 'That plan is no longer available.')
  const cycle = input.cycle ?? input.patch?.billing_cycle ?? initial.subscription?.cycle ?? 'monthly'
  const price = priceIdForCycle(plan, cycle)
  if (input.mode === 'checkout' && !initial.subscription) {
    if (!price) throw new AdminMenuError(503, 'Plan not configured for billing. Run `npm run stripe:setup-plans`.')
    initial = await deps.database.run(true, query => ensureCheckoutSubscription(query, context, plan.id, cycle))
  }
  const facts: ProviderObject = { mode: input.mode, tenantId: context.tenantId, actorId: context.actorId, baseline: baseline(initial.subscription), targetPlan: plan, cycle, requiresActivePlan: !!(input.planId || input.patch?.plan_id),
    localPatch: input.mode === 'admin' ? input.patch ?? null : null, patchBaseline: input.patch ? Object.fromEntries(Object.keys(input.patch).map(key => [key, initial.subscription?.raw[key] ?? null])) : null,
    slug: initial.slug, existing: !!initial.subscription, warning: false }
  if (open && financialIntent) {
    if (!open.objectId || hashFacts(open.context) !== hashFacts(provider)) throw billingUnavailable()
    const session = parseCheckout(await deps.gateway.checkout(open.objectId), open.body, provider, open.objectId)
    if (session.status === 'open' && input.mode === 'checkout' && record(open.facts.targetPlan).id === plan.id && open.facts.cycle === cycle) {
      await deps.database.run(true, query => subscriptionSnapshot(query, context, true)); return { body: { url: session.url } }
    }
    if (session.status === 'open') {
      const expireFacts = { ...facts, relatedRequestId: open.id, sessionId: session.id, checkoutBody: open.body }
      const retire = await deps.database.run(true, query => prepareSubscriptionRequest(query, context, { operation: 'expire_checkout', body: {}, facts: expireFacts, provider }, now(deps)))
      const closed = await executeRequest(context, retire, provider, deps)
      if (closed.kind !== 'closed') throw billingUnavailable()
      if (closed.session.status === 'complete') throw new AdminMenuError(409, 'Checkout completed. Refresh before changing the plan.')
    } else {
      await deps.database.run(true, query => closeObservedCheckout(query, context, open, sessionResult(session)))
      sessionSubscription = session.subscriptionId; sessionCustomer = session.customerId
    }
  }
  if (!sessionSubscription && known) {
    if (hashFacts(known.context) !== hashFacts(provider)) throw billingUnavailable()
    sessionSubscription = providerReference(known.result?.subscriptionId); sessionCustomer = providerReference(known.result?.customerId)
  }
  const subscriptionId = initial.subscription?.subscriptionId
  let live = subscriptionId ? await liveSubscription(deps, subscriptionId, context.tenantId, initial.subscription?.customerId ?? null, provider) : null
  if (sessionSubscription && sessionSubscription !== subscriptionId) {
    const completed = await liveSubscription(deps, sessionSubscription, context.tenantId, sessionCustomer, provider)
    if (live && completed) throw new AdminMenuError(409, 'More than one billing subscription requires reconciliation')
    live ??= completed
  }
  const patch: SubscriptionPatch | undefined = input.mode === 'admin' ? input.patch : input.mode === 'cycle' ? { billing_cycle: cycle } : undefined
  if (live) {
    facts.providerSubscriptionId = live.id; facts.providerCustomerId = live.customerId
    facts.warning = input.mode === 'admin' && patch?.status !== undefined && patch.status !== initial.subscription?.status
    const needsChange = input.mode !== 'admin' || (patch?.plan_id !== undefined && patch.plan_id !== initial.subscription?.planId) || (patch?.billing_cycle !== undefined && patch.billing_cycle !== initial.subscription?.cycle)
    const body = needsChange ? planChangeBody({ subscription: live, tenantId: context.tenantId, plan, cycle, prorationDate: Math.floor(now(deps).getTime() / 1000) }) : null
    if (body) {
      const frozen = await deps.database.run(true, query => prepareSubscriptionRequest(query, context, { operation: 'plan_change', body: body as ProviderObject, facts, provider }, now(deps)))
      const outcome = await executeRequest(context, frozen, provider, deps)
      if (outcome.kind !== 'changed') throw billingUnavailable()
      return changedResponse(context, input, facts, outcome.result)
    }
    if (input.mode !== 'admin') { await deps.database.run(true, query => subscriptionSnapshot(query, context, true)); return changedResponse(context, input, facts, undefined, false) }
  }
  if (input.mode !== 'checkout') {
    return localChange(context, input, initial, deps, facts.warning === true)
  }
  if (!price) throw new AdminMenuError(503, 'Plan not configured for billing. Run `npm run stripe:setup-plans`.')
  const metadata = { kind: 'plan', tenant_id: context.tenantId, plan_id: plan.id }
  const body: ProviderObject = { mode: 'subscription', line_items: [{ price, quantity: 1 }], ...(initial.subscription?.customerId ? { customer: initial.subscription.customerId } : {}), metadata, subscription_data: { metadata },
    success_url: `${deps.baseUrl}/settings/subscription?plan=success`, cancel_url: `${deps.baseUrl}/settings/subscription?plan=cancelled`, expires_at: Math.floor(now(deps).getTime() / 1000) + 24 * 60 * 60 }
  const frozen = await deps.database.run(true, query => prepareSubscriptionRequest(query, context, { operation: 'checkout', body, facts, provider }, now(deps)))
  const outcome = await executeRequest(context, frozen, provider, deps)
  if (outcome.kind !== 'checkout') throw new AdminMenuError(409, 'Checkout completed. Refresh before changing the plan.')
  return { body: { url: outcome.session.url } }
}
export async function nativeSubscriptionPortal(context: SubscriptionActor, deps: SubscriptionDependencies) {
  const snapshot = await deps.database.run(true, query => subscriptionSnapshot(query, context, true))
  const customer = snapshot.subscription?.customerId
  if (!customer) throw new AdminMenuError(400, 'No active billing customer. Subscribe first.')
  const session = record(await deps.gateway.portal(customer, `${deps.baseUrl}/settings/subscription`)), url = session.url
  if (!providerId(session.id) || typeof url !== 'string' || new URL(url).protocol !== 'https:' || providerReference(session.customer) !== customer) throw billingUnavailable()
  await deps.database.run(true, query => subscriptionSnapshot(query, context, true))
  return { url }
}
