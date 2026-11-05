import { randomUUID } from 'node:crypto'
import { hashFacts, validContext, BILLING_RETRY_WINDOW_MS, BILLING_LEASE_MS, type BillingProviderContext } from '../ai/native-billing-facts'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { authorizeSubscription, billingUnavailable, readBillingPlan, subscriptionSnapshot, writeSubscriptionPatch, type SubscriptionActor, type SubscriptionPatch } from './subscription-billing'

type Json = Record<string, unknown>
export type SubscriptionOperation = 'checkout' | 'plan_change' | 'expire_checkout'
export interface SubscriptionRequest { id: string; tenantId: string; actorId: string; operation: SubscriptionOperation; body: Json; facts: Json; context: BillingProviderContext; hash: string; state: string; firstAttemptAt: Date | null; leaseUntil: Date | null; token: string | null; objectId: string | null; result: Json | null }
const object = (value: unknown): Json => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw billingUnavailable(); return value as Json }
const date = (value: unknown): Date | null => { if (value == null) return null; const parsed = value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(parsed.getTime())) throw billingUnavailable(); return parsed }
function request(row: Json): SubscriptionRequest {
  const value: SubscriptionRequest = { id: String(row.id), tenantId: String(row.original_tenant_id), actorId: String(row.original_actor_id), operation: row.operation as SubscriptionOperation,
    body: object(row.request_body), facts: object(row.facts), context: validContext(row.provider_context as BillingProviderContext), hash: String(row.request_hash), state: String(row.state),
    firstAttemptAt: date(row.first_attempt_at), leaseUntil: date(row.lease_until), token: row.attempt_token == null ? null : String(row.attempt_token), objectId: row.provider_object_id == null ? null : String(row.provider_object_id), result: row.result == null ? null : object(row.result) }
  if (!['checkout','plan_change','expire_checkout'].includes(value.operation) || hashFacts({ operation: value.operation, body: value.body, facts: value.facts, context: value.context }) !== value.hash) throw billingUnavailable()
  return value
}
function one(rows: Json[]) { if (rows.length > 1) throw billingUnavailable(); return rows[0] }
async function validateSnapshot(query: AdminMenuQuery, context: SubscriptionActor, facts: Json, operation: SubscriptionOperation, completion?: Json) {
  const snapshot = await subscriptionSnapshot(query, context, true, facts.mode === 'admin'), baseline = object(facts.baseline), current = snapshot.subscription
  if ((current?.id ?? null) !== baseline.id) throw billingUnavailable()
  if (current) {
    const target = facts.targetPlan == null ? null : object(facts.targetPlan)
    const subAllowed = [baseline.subscriptionId]
    const customerAllowed = [baseline.customerId]
    if (operation === 'plan_change') { subAllowed.push(facts.providerSubscriptionId); customerAllowed.push(facts.providerCustomerId) }
    if (completion && operation === 'checkout') { subAllowed.push(completion.subscriptionId); customerAllowed.push(completion.customerId) }
    if (!subAllowed.includes(current.subscriptionId) || !customerAllowed.includes(current.customerId)
      || (current.planId !== baseline.planId && current.planId !== target?.id) || (current.cycle !== baseline.cycle && current.cycle !== facts.cycle)) throw billingUnavailable()
    if (facts.patchBaseline && facts.localPatch) {
      const before = object(facts.patchBaseline), patch = object(facts.localPatch)
      for (const key of Object.keys(patch)) if (current.raw[key] !== before[key] && current.raw[key] !== patch[key]) throw billingUnavailable()
    }
  }
  if (facts.targetPlan && operation !== 'expire_checkout') {
    const expected = object(facts.targetPlan), target = await readBillingPlan(query, String(expected.id), true)
    if (!target || (facts.requiresActivePlan === true && !target.is_active) || target.stripe_price_monthly_id !== expected.stripe_price_monthly_id || target.stripe_price_annual_id !== expected.stripe_price_annual_id) throw billingUnavailable()
  }
  return snapshot
}
export async function readPendingSubscriptionRequest(query: AdminMenuQuery, context: SubscriptionActor) {
  await authorizeSubscription(query, context)
  const row = one((await query("SELECT * FROM public.app_subscription_billing_requests WHERE tenant_id=$1 AND state IN('prepared','requesting','reconcile_required') LIMIT 2", [context.tenantId])).rows)
  return row ? request(row) : null
}
export async function readOpenSubscriptionCheckout(query: AdminMenuQuery, context: SubscriptionActor) {
  await authorizeSubscription(query, context)
  const row = one((await query("SELECT * FROM public.app_subscription_billing_requests WHERE tenant_id=$1 AND operation='checkout' AND state='open_checkout' LIMIT 2", [context.tenantId])).rows)
  return row ? request(row) : null
}
export async function readCompletedSubscriptionCheckout(query: AdminMenuQuery, context: SubscriptionActor) {
  await authorizeSubscription(query, context)
  const rows = await query("SELECT * FROM public.app_subscription_billing_requests WHERE tenant_id=$1 AND operation='checkout' AND state='completed' AND result->>'subscriptionId' IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1", [context.tenantId])
  return rows.rows[0] ? request(rows.rows[0]) : null
}
export async function prepareSubscriptionRequest(query: AdminMenuQuery, context: SubscriptionActor, input: { operation: SubscriptionOperation; body: Json; facts: Json; provider: BillingProviderContext }, now = new Date()) {
  await validateSnapshot(query, context, input.facts, input.operation)
  const pending = await readPendingSubscriptionRequest(query, context)
  const hash = hashFacts({ operation: input.operation, body: input.body, facts: input.facts, context: validContext(input.provider) })
  if (pending) {
    if (pending.actorId !== context.actorId || pending.hash !== hash || pending.state === 'reconcile_required') throw new AdminMenuError(409, 'A billing request requires reconciliation before another change')
    return pending
  }
  if (input.operation === 'checkout' && await readOpenSubscriptionCheckout(query, context)) throw new AdminMenuError(409, 'Finish or replace the current checkout before opening another')
  const rows = await query(`INSERT INTO public.app_subscription_billing_requests(id,tenant_id,actor_id,original_tenant_id,original_actor_id,operation,request_body,facts,provider_context,request_hash,created_at,state)
    VALUES($1,$2,$3,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,'prepared') RETURNING *`, [randomUUID(), context.tenantId, context.actorId, input.operation, JSON.stringify(input.body), JSON.stringify(input.facts), JSON.stringify(input.provider), hash, now.toISOString()])
  return request(rows.rows[0])
}
async function lockedRequest(query: AdminMenuQuery, context: SubscriptionActor, frozen: SubscriptionRequest, completion?: Json) {
  await validateSnapshot(query, context, frozen.facts, frozen.operation, completion)
  const row = one((await query('SELECT * FROM public.app_subscription_billing_requests WHERE id=$1 AND tenant_id=$2 AND actor_id=$3 FOR UPDATE', [frozen.id, context.tenantId, context.actorId])).rows)
  if (!row) throw billingUnavailable()
  const current = request(row)
  if (current.hash !== frozen.hash || current.tenantId !== context.tenantId || current.actorId !== context.actorId) throw billingUnavailable()
  return current
}
export async function claimSubscriptionRequest(query: AdminMenuQuery, context: SubscriptionActor, frozen: SubscriptionRequest, provider: BillingProviderContext, now = new Date()) {
  const current = await lockedRequest(query, context, frozen)
  if (hashFacts(current.context) !== hashFacts(validContext(provider)) || !['prepared','requesting'].includes(current.state)) throw billingUnavailable()
  if (current.leaseUntil && current.leaseUntil.getTime() > now.getTime()) throw new AdminMenuError(409, 'A billing request is already in progress')
  if (current.firstAttemptAt && (now.getTime() < current.firstAttemptAt.getTime() || now.getTime() - current.firstAttemptAt.getTime() >= BILLING_RETRY_WINDOW_MS)) {
    await query("UPDATE public.app_subscription_billing_requests SET state='reconcile_required',attempt_token=NULL,lease_until=NULL WHERE id=$1", [current.id]); return null
  }
  const token = randomUUID()
  const changed = await query("UPDATE public.app_subscription_billing_requests SET state='requesting',first_attempt_at=COALESCE(first_attempt_at,$2),attempt_token=$3,lease_until=$4 WHERE id=$1 RETURNING *", [current.id, now.toISOString(), token, new Date(now.getTime() + BILLING_LEASE_MS).toISOString()])
  return request(changed.rows[0])
}
export async function refuseSubscriptionRequest(query: AdminMenuQuery, context: SubscriptionActor, frozen: SubscriptionRequest, rejected = false) {
  await query(`UPDATE public.app_subscription_billing_requests SET state=$4,attempt_token=NULL,lease_until=NULL WHERE id=$1 AND original_tenant_id=$2 AND original_actor_id=$3 AND request_hash=$5
    AND ((state='prepared' AND $6::uuid IS NULL) OR (state='requesting' AND attempt_token=$6))`, [frozen.id, context.tenantId, context.actorId, rejected ? 'rejected' : 'reconcile_required', frozen.hash, frozen.token])
}
export async function finishSubscriptionRequest(query: AdminMenuQuery, context: SubscriptionActor, frozen: SubscriptionRequest, objectId: string, result: Json, patch?: SubscriptionPatch, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw billingUnavailable()
  const current = await lockedRequest(query, context, frozen, result)
  if (current.state !== 'requesting' || !frozen.token || current.token !== frozen.token) throw billingUnavailable()
  let subscription: Json | undefined
  if (patch) {
    const snapshot = await subscriptionSnapshot(query, context, true, current.facts.mode === 'admin')
    subscription = await writeSubscriptionPatch(query, context, patch, snapshot.subscription, current.facts.mode === 'admin', `subscription:${current.id}`)
  }
  if (current.operation === 'expire_checkout') {
    const related = current.facts.relatedRequestId
    if (typeof related !== 'string') throw billingUnavailable()
    const changed = await query("UPDATE public.app_subscription_billing_requests SET state='completed',result=$3::jsonb WHERE id=$1 AND tenant_id=$2 AND operation='checkout' AND state='open_checkout' RETURNING id", [related, context.tenantId, JSON.stringify(result)])
    if (changed.rows.length !== 1) throw billingUnavailable()
  }
  await query("UPDATE public.app_subscription_billing_requests SET state=$2,provider_object_id=$3,result=$4::jsonb,attempt_token=NULL,lease_until=NULL WHERE id=$1", [current.id, current.operation === 'checkout' ? 'open_checkout' : 'completed', objectId, JSON.stringify(result)])
  return subscription
}
export async function closeObservedCheckout(query: AdminMenuQuery, context: SubscriptionActor, frozen: SubscriptionRequest, result: Json) {
  await authorizeSubscription(query, context, true)
  const changed = await query("UPDATE public.app_subscription_billing_requests SET state='completed',result=$3::jsonb WHERE id=$1 AND tenant_id=$2 AND operation='checkout' AND state='open_checkout' AND request_hash=$4 RETURNING id", [frozen.id, context.tenantId, JSON.stringify(result), frozen.hash])
  if (changed.rows.length !== 1) throw billingUnavailable()
}
