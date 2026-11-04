import { randomUUID } from 'node:crypto'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { invoiceSubscriptionId, type SaasWebhookEvent } from './saas-webhooks'
import { BILLING_LEASE_MS, BILLING_RETRY_WINDOW_MS, hashFacts, makeBillingBody, matchesBillingItem, unavailable, usageFacts, validContext, validId, type BillingProviderContext, type BillingRequestBody, type BillingUsage } from '../ai/native-billing-facts'
import type { BillResult } from '../ai/billing'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Row = Record<string, unknown>
export interface BillingEvent { id: string; invoiceId: string; subscriptionId: string }
export interface NativeBillingOptions { tenantId: string; invoiceId?: string; currency?: string; now?: Date; event?: BillingEvent }
export interface NativeBillingRequest {
  batchId: string; tenantId: string; body: BillingRequestBody; context: BillingProviderContext; requestHash: string; usageDigest: string
  events: number; costUsd: number; chargeUsd: number; maxEventId: string; state: string; firstAttemptAt: Date | null; leaseUntil: Date | null; sourceEventId: string | null
}
export type BillingPreparation = { kind: 'done'; result: BillResult; skipped?: true } | { kind: 'context' } | { kind: 'request'; request: NativeBillingRequest }
const one = (rows: Row[]) => { if (rows.length > 1) throw unavailable(); return rows[0] }
const asDate = (value: unknown): Date | null => value == null ? null : value instanceof Date ? value : new Date(String(value))
function request(row: Row): NativeBillingRequest {
  const context = validContext(row.provider_context as BillingProviderContext), body = row.request_body as BillingRequestBody
  const result: NativeBillingRequest = { batchId: String(row.batch_id), tenantId: String(row.tenant_id), body, context, requestHash: String(row.request_hash), usageDigest: String(row.usage_digest),
    events: Number(row.event_count), costUsd: Number(row.cost_usd), chargeUsd: Number(row.charge_usd), maxEventId: String(row.max_event_id), state: String(row.state),
    firstAttemptAt: asDate(row.first_attempt_at), leaseUntil: asDate(row.lease_until), sourceEventId: row.source_event_id == null ? null : String(row.source_event_id) }
  if (!UUID.test(result.batchId) || !UUID.test(result.tenantId) || !body || !validId(body.customer) || !/^[a-z]{3}$/.test(body.currency) || !Number.isSafeInteger(body.amount) || body.amount < 1
    || !Number.isInteger(result.events) || result.events < 1 || result.events > 50000 || !Number.isFinite(result.costUsd) || !Number.isFinite(result.chargeUsd)
    || result.costUsd < 0 || result.chargeUsd < 0 || hashFacts({ body, context }) !== result.requestHash || body.metadata?.billing_batch !== result.batchId || body.metadata?.tenant_id !== result.tenantId
    || !/^[a-f0-9]{64}$/.test(result.usageDigest) || !['prepared','requesting','confirmed','reconcile_required'].includes(result.state)
    || (result.firstAttemptAt && !Number.isFinite(result.firstAttemptAt.getTime())) || (result.leaseUntil && !Number.isFinite(result.leaseUntil.getTime()))) throw unavailable()
  return result
}
async function lockTenant(query: AdminMenuQuery, tenantId: string) {
  if (!UUID.test(tenantId) || !(await query('SELECT id FROM public.tenants WHERE id=$1 FOR UPDATE', [tenantId])).rows.length) throw unavailable()
}
async function eventSeen(query: AdminMenuQuery, event?: BillingEvent) {
  if (!event) return false
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id) || !validId(event.invoiceId) || !validId(event.subscriptionId)) throw unavailable()
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,190732))', [event.id])
  const row = one((await query('SELECT event_type FROM public.processed_stripe_events WHERE event_id=$1', [event.id])).rows)
  if (row && row.event_type !== null && row.event_type !== 'invoice.created') throw unavailable()
  return !!row
}
async function receipt(query: AdminMenuQuery, event: BillingEvent | undefined, now: Date) {
  if (event) await query("INSERT INTO public.processed_stripe_events(event_id,event_type,processed_at) VALUES($1,'invoice.created',$2)", [event.id, now.toISOString()])
}
function resultFor(value: NativeBillingRequest, itemId?: string): BillResult {
  return { billed: !!itemId, events: value.events, costUsd: value.costUsd, chargeUsd: value.chargeUsd, amountMinor: value.body.amount, currency: value.body.currency, ...(itemId ? { invoiceItemId: itemId } : {}) }
}
async function usage(query: AdminMenuQuery, tenantId: string, batch: string | null, now: Date): Promise<BillingUsage[]> {
  const rows = (await query(`SELECT id::text,cost_usd::text,charge_usd::text FROM public.ai_usage_events WHERE tenant_id=$1 AND billable=true AND invoiced_at IS NULL
    AND ${batch ? 'billing_batch=$2' : 'billing_batch IS NULL AND occurred_at<=$2'} ORDER BY id LIMIT 50001 FOR UPDATE`, [tenantId, batch ?? now.toISOString()])).rows
  return rows.map(row => ({ id: String(row.id), cost_usd: String(row.cost_usd), charge_usd: String(row.charge_usd) }))
}

/** Resolve only signed renewal events; no writes or provider calls. */
export async function nativeInvoiceTarget(query: AdminMenuQuery, event: SaasWebhookEvent): Promise<NativeBillingOptions | null> {
  if (event.type !== 'invoice.created' || !event.data.object || typeof event.data.object !== 'object') return null
  // Once this event has a financial request, changing its subscription tuple
  // must not turn an unsettled delivery into a harmless/no-op success receipt.
  const prior = one((await query('SELECT tenant_id,request_body FROM public.ai_billing_requests WHERE source_event_id=$1 LIMIT 2', [event.id])).rows)
  const invoice = event.data.object as Row, subscriptionId = invoiceSubscriptionId(invoice)
  if (invoice.status !== 'draft' || invoice.billing_reason !== 'subscription_cycle' || !subscriptionId) { if (prior) throw unavailable(); return null }
  if (!validId(invoice.id) || !validId(subscriptionId)) throw unavailable()
  const row = one((await query('SELECT tenant_id FROM public.tenant_subscriptions WHERE stripe_subscription_id=$1 LIMIT 2', [subscriptionId])).rows)
  if (!row) { if (prior) throw unavailable(); return null }
  if (prior && (prior.tenant_id !== row.tenant_id || (prior.request_body as Row)?.invoice !== invoice.id)) throw unavailable()
  return { tenantId: String(row.tenant_id), invoiceId: invoice.id, currency: typeof invoice.currency === 'string' ? invoice.currency : undefined, event: { id: event.id, invoiceId: invoice.id, subscriptionId } }
}

/** Called only in a bounded write transaction. Context absence never claims usage. */
export async function prepareNativeBilling(query: AdminMenuQuery, options: NativeBillingOptions, context?: BillingProviderContext): Promise<BillingPreparation> {
  const now = options.now ?? new Date(), currency = (options.currency ?? 'brl').toLowerCase()
  if (!Number.isFinite(now.getTime()) || !/^[a-z]{3}$/.test(currency) || (options.invoiceId !== undefined && !validId(options.invoiceId)) || (options.event && options.event.invoiceId !== options.invoiceId)) throw unavailable()
  const empty: BillResult = { billed: false, events: 0, costUsd: 0, chargeUsd: 0, amountMinor: 0, currency }
  if (await eventSeen(query, options.event)) return { kind: 'done', result: empty, skipped: true }
  await lockTenant(query, options.tenantId)
  if (options.event && !(await query('SELECT tenant_id FROM public.tenant_subscriptions WHERE tenant_id=$1 AND stripe_subscription_id=$2 LIMIT 2 FOR UPDATE', [options.tenantId, options.event.subscriptionId])).rows.length) throw unavailable()
  const existing = one((await query("SELECT * FROM public.ai_billing_requests WHERE tenant_id=$1 AND state<>'confirmed' LIMIT 2 FOR UPDATE", [options.tenantId])).rows)
  if (existing) {
    const frozen = request(existing)
    if ((frozen.body.invoice ?? null) !== (options.invoiceId ?? null) || frozen.sourceEventId !== (options.event?.id ?? null)) throw unavailable()
    return { kind: 'request', request: frozen }
  }
  if ((await query('SELECT 1 FROM public.ai_usage_events WHERE tenant_id=$1 AND billable=true AND invoiced_at IS NULL AND billing_batch IS NOT NULL LIMIT 1', [options.tenantId])).rows.length) throw unavailable()
  const sub = one((await query('SELECT stripe_customer_id FROM public.tenant_subscriptions WHERE tenant_id=$1 LIMIT 2 FOR SHARE', [options.tenantId])).rows)
  const finishEmpty = async (reason: BillResult['reason'], facts?: Partial<BillResult>): Promise<BillingPreparation> => { await receipt(query, options.event, now); return { kind: 'done', result: { ...empty, ...facts, reason } } }
  if (!sub?.stripe_customer_id) return finishEmpty('no_stripe_customer')
  const rows = await usage(query, options.tenantId, null, now)
  if (!rows.length) return finishEmpty('nothing_to_bill')
  const facts = usageFacts(rows), platform = one((await query('SELECT usd_to_brl FROM public.platform_ai_settings WHERE id=1 LIMIT 2 FOR SHARE')).rows)
  // Match the legacy default; invalid persisted non-zero rates fail closed.
  const rate = Number(platform?.usd_to_brl ?? 5.5) || 5.5, batchId = randomUUID()
  const body = makeBillingBody({ tenantId: options.tenantId, batchId, customer: String(sub.stripe_customer_id), invoice: options.invoiceId, currency, now, usdToBrl: rate }, facts)
  if (body.amount < 1) return finishEmpty('below_minimum', { events: facts.events, costUsd: facts.costUsd, chargeUsd: facts.chargeUsd })
  if (!context) return { kind: 'context' }
  validContext(context)
  const changed = await query('UPDATE public.ai_usage_events SET billing_batch=$2 WHERE tenant_id=$1 AND id=ANY($3::bigint[]) AND billable=true AND invoiced_at IS NULL AND billing_batch IS NULL RETURNING id', [options.tenantId, batchId, rows.map(row => row.id)])
  if (changed.rows.length !== rows.length) throw unavailable()
  const inserted = await query(`INSERT INTO public.ai_billing_requests(batch_id,tenant_id,created_at,cutoff_at,request_body,provider_context,request_hash,usage_digest,event_count,cost_usd,charge_usd,max_event_id,state,source_event_id)
    VALUES($1,$2,$3,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,'prepared',$12) RETURNING *`, [batchId, options.tenantId, now.toISOString(), JSON.stringify(body), JSON.stringify(context), hashFacts({ body, context }), facts.usageDigest, facts.events, facts.costUsd, facts.chargeUsd, facts.maxEventId, options.event?.id ?? null])
  return { kind: 'request', request: request(inserted.rows[0]) }
}

/** A durable attempt must commit before the caller invokes the provider. */
export async function claimNativeBilling(query: AdminMenuQuery, frozen: NativeBillingRequest, context: BillingProviderContext, now = new Date()): Promise<{ request: NativeBillingRequest; token: string } | null> {
  await lockTenant(query, frozen.tenantId)
  const row = one((await query('SELECT * FROM public.ai_billing_requests WHERE tenant_id=$1 AND batch_id=$2 FOR UPDATE', [frozen.tenantId, frozen.batchId])).rows)
  if (!row) throw unavailable()
  const current = request(row)
  if (current.requestHash !== frozen.requestHash || hashFacts(current.context) !== hashFacts(validContext(context))) throw unavailable()
  if (current.state === 'confirmed' || current.state === 'reconcile_required') throw unavailable()
  if (!Number.isFinite(now.getTime()) || (current.leaseUntil && current.leaseUntil.getTime() > now.getTime())) throw new AdminMenuError(503, 'AI billing is already in progress')
  if (current.firstAttemptAt && (now.getTime() < current.firstAttemptAt.getTime() || now.getTime() - current.firstAttemptAt.getTime() >= BILLING_RETRY_WINDOW_MS)) {
    await query("UPDATE public.ai_billing_requests SET state='reconcile_required',attempt_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND batch_id=$2", [current.tenantId, current.batchId])
    return null
  }
  const rows = await usage(query, current.tenantId, current.batchId, now), facts = usageFacts(rows)
  if (facts.usageDigest !== current.usageDigest || facts.events !== current.events) throw unavailable()
  const token = randomUUID()
  const changed = await query("UPDATE public.ai_billing_requests SET state='requesting',first_attempt_at=COALESCE(first_attempt_at,$3),attempt_token=$4,lease_until=$5 WHERE tenant_id=$1 AND batch_id=$2 RETURNING *", [current.tenantId, current.batchId, now.toISOString(), token, new Date(now.getTime() + BILLING_LEASE_MS).toISOString()])
  return { request: request(changed.rows[0]), token }
}

/** Provider failure/mismatch stays blocked; never release claimed financial facts. */
export async function refuseNativeBilling(query: AdminMenuQuery, frozen: NativeBillingRequest, token: string) {
  await lockTenant(query, frozen.tenantId)
  await query("UPDATE public.ai_billing_requests SET state='reconcile_required',attempt_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND batch_id=$2 AND state='requesting' AND attempt_token=$3", [frozen.tenantId, frozen.batchId, token])
}
export async function finalizeNativeBilling(query: AdminMenuQuery, frozen: NativeBillingRequest, token: string, item: unknown, options: NativeBillingOptions, now = new Date()): Promise<BillResult> {
  if (await eventSeen(query, options.event)) throw unavailable()
  await lockTenant(query, frozen.tenantId)
  const row = one((await query('SELECT * FROM public.ai_billing_requests WHERE tenant_id=$1 AND batch_id=$2 FOR UPDATE', [frozen.tenantId, frozen.batchId])).rows)
  if (!row) throw unavailable()
  const current = request(row)
  if (current.state !== 'requesting' || row.attempt_token !== token || current.requestHash !== frozen.requestHash || current.sourceEventId !== (options.event?.id ?? null) || !matchesBillingItem(item, current.body, current.context)) throw unavailable()
  const facts = usageFacts(await usage(query, current.tenantId, current.batchId, now))
  if (facts.usageDigest !== current.usageDigest || facts.events !== current.events) throw unavailable()
  const changed = await query('UPDATE public.ai_usage_events SET invoiced_at=$3,stripe_invoice_item_id=$4 WHERE tenant_id=$1 AND billing_batch=$2 AND billable=true AND invoiced_at IS NULL RETURNING id', [current.tenantId, current.batchId, now.toISOString(), item.id])
  if (changed.rows.length !== current.events) throw unavailable()
  await query("UPDATE public.ai_billing_requests SET state='confirmed',stripe_invoice_item_id=$3,confirmed_at=$4,attempt_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND batch_id=$2 AND attempt_token=$5", [current.tenantId, current.batchId, item.id, now.toISOString(), token])
  await receipt(query, options.event, now)
  return resultFor(current, item.id)
}
