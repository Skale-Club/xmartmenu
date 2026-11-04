import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { reconcileNativeTenantPlan } from './tenant-plan'
import type { SyncReason } from '../xphere/types'

type Row = Record<string, unknown>
export interface SaasWebhookEvent { id: string; type: string; data: { object: unknown } }
export interface SaasWebhookResult {
  received: true; skipped?: true
  pendingSync?: { tenantId: string; reason: SyncReason; tags?: string[] }
  disabledAccountId?: string
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAYMENT_TYPES = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'])
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
function one(rows: Row[]) { if (rows.length > 1) throw new AdminMenuError(503, 'Webhook metadata is ambiguous'); return rows[0] }
function tenantId(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new AdminMenuError(400, 'Invalid event tenant'); return value }
function providerId(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 255) throw new AdminMenuError(400, 'Invalid provider object'); return value }
function timestamp(value: unknown): string | null {
  if (typeof value !== 'number') return null
  try { return new Date(value * 1000).toISOString() } catch { throw new AdminMenuError(400, 'Invalid event period') }
}
export function invoiceSubscriptionId(invoice: Row): string | null {
  if (typeof invoice.subscription === 'string') return invoice.subscription
  const fromParent = record(record(invoice.parent).subscription_details).subscription
  if (typeof fromParent === 'string') return fromParent
  const lines = record(invoice.lines).data
  if (!Array.isArray(lines)) return null
  for (const line of lines) { const value = record(record(record(line).parent).subscription_item_details).subscription; if (typeof value === 'string') return value }
  return null
}
async function lockTenant(query: AdminMenuQuery, id: string) { await query('SELECT id FROM public.tenants WHERE id=$1 FOR UPDATE', [id]) }
async function updateSubscription(query: AdminMenuQuery, id: string, patch: Row) {
  const keys = Object.keys(patch)
  await query(`UPDATE public.tenant_subscriptions SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')} WHERE tenant_id=$1`, [id, ...Object.values(patch)])
}
async function subscriptionTenant(query: AdminMenuQuery, subscriptionId: string) {
  const found = one((await query('SELECT tenant_id FROM public.tenant_subscriptions WHERE stripe_subscription_id=$1 LIMIT 2', [subscriptionId])).rows)
  return found ? tenantId(found.tenant_id) : null
}

/** Signature verification is the caller's prerequisite. No provider/API calls. */
export async function applySaasWebhook(query: AdminMenuQuery, event: SaasWebhookEvent, now = new Date()): Promise<SaasWebhookResult> {
  if (PAYMENT_TYPES.has(event.type)) throw new AdminMenuError(503, 'Payment event requires the payment repository')
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id) || typeof event.type !== 'string' || !event.type || event.type.length > 160 || !Number.isFinite(now.getTime())) throw new AdminMenuError(400, 'Invalid webhook event')
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,190732))', [event.id])
  const previous = one((await query('SELECT event_type FROM public.processed_stripe_events WHERE event_id=$1', [event.id])).rows)
  if (previous) {
    if (previous.event_type !== null && previous.event_type !== event.type) throw new AdminMenuError(503, 'Webhook event identity conflict')
    return { received: true, skipped: true }
  }
  const value = record(event.data.object), metadata = record(value.metadata), result: SaasWebhookResult = { received: true }
  switch (event.type) {
    case 'checkout.session.completed': {
      if (!metadata.tenant_id || (metadata.kind !== 'plan' && metadata.addon !== 'chat')) break
      const id = tenantId(metadata.tenant_id)
      await lockTenant(query, id)
      const customer = typeof value.customer === 'string' && value.customer ? value.customer : null
      if (metadata.kind === 'plan') {
        const patch: Row = { status: 'active', cancel_at_period_end: false }
        if (metadata.plan_id) patch.plan_id = tenantId(metadata.plan_id)
        if (customer) patch.stripe_customer_id = customer
        if (typeof value.subscription === 'string' && value.subscription) patch.stripe_subscription_id = value.subscription
        await updateSubscription(query, id, patch)
        result.pendingSync = { tenantId: id, reason: 'plan_activated' }
      } else {
        await updateSubscription(query, id, { chat_addon_active: true, chat_addon_since: now.toISOString(), ...(customer ? { stripe_customer_id: customer } : {}) })
      }
      break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      if (!metadata.tenant_id || (metadata.kind !== 'plan' && metadata.addon !== 'chat')) break
      const id = tenantId(metadata.tenant_id), deleted = event.type === 'customer.subscription.deleted'
      await lockTenant(query, id)
      if (metadata.kind === 'plan') {
        const subscriptionId = providerId(value.id)
        const prior = one((await query('SELECT plan_id FROM public.tenant_subscriptions WHERE tenant_id=$1 LIMIT 2 FOR UPDATE', [id])).rows)
        const priorPlan = typeof prior?.plan_id === 'string' ? prior.plan_id : null
        const items = record(value.items).data, item = record(Array.isArray(items) ? items[0] : undefined), price = record(item.price).id
        let newPlan: string | null = null, cycle: 'annual' | 'monthly' | null = null
        if (!deleted && typeof price === 'string' && price) {
          const matched = one((await query(`SELECT id,stripe_price_annual_id FROM public.plans WHERE stripe_price_monthly_id=$1 OR stripe_price_annual_id=$1 LIMIT 2 FOR SHARE`, [price])).rows)
          if (matched) { newPlan = tenantId(matched.id); cycle = matched.stripe_price_annual_id === price ? 'annual' : 'monthly' }
        }
        const status = deleted || value.status === 'canceled' || value.status === 'incomplete_expired' ? 'cancelled'
          : value.status === 'trialing' ? 'trial' : value.status === 'active' ? 'active' : 'past_due'
        if (value.cancel_at_period_end != null && typeof value.cancel_at_period_end !== 'boolean') throw new AdminMenuError(400, 'Invalid cancellation state')
        await updateSubscription(query, id, { status, cancel_at_period_end: value.cancel_at_period_end ?? false,
          current_period_start: timestamp(value.current_period_start ?? item.current_period_start), current_period_end: timestamp(value.current_period_end ?? item.current_period_end),
          stripe_subscription_id: subscriptionId, ...(newPlan ? { plan_id: newPlan } : {}), ...(cycle ? { billing_cycle: cycle } : {}) })
        await reconcileNativeTenantPlan(query, id)
        if (deleted) result.pendingSync = { tenantId: id, reason: 'churned' }
        else if (newPlan && priorPlan && newPlan !== priorPlan) {
          const tiers = (await query('SELECT id,sort_order FROM public.plans WHERE id=ANY($1::uuid[]) LIMIT 3 FOR SHARE', [[priorPlan, newPlan]])).rows
          const before = Number(tiers.find(row => row.id === priorPlan)?.sort_order ?? 0), after = Number(tiers.find(row => row.id === newPlan)?.sort_order ?? 0)
          result.pendingSync = { tenantId: id, reason: 'plan_changed', tags: [after > before ? 'upgrade' : 'downgrade'] }
        }
      } else {
        const active = !deleted && (value.status === 'active' || value.status === 'trialing')
        await updateSubscription(query, id, { chat_addon_active: active })
        if (!active) await query('UPDATE public.chat_addon_settings SET enabled=false WHERE tenant_id=$1', [id])
      }
      break
    }
    case 'invoice.created': {
      const subscription = invoiceSubscriptionId(value)
      if (value.status === 'draft' && value.billing_reason === 'subscription_cycle' && subscription) {
        const id = await subscriptionTenant(query, subscription)
        // Preparation gate: do not call the Source biller, charge Stripe, or
        // record a success while native persistent request facts are missing.
        if (id) {
          const current = one((await query('SELECT stripe_customer_id FROM public.tenant_subscriptions WHERE tenant_id=$1 AND stripe_subscription_id=$2 LIMIT 2', [id, subscription])).rows)
          if (!current) throw new AdminMenuError(503, 'Subscription identity changed')
          if (current.stripe_customer_id) {
            const eligible = await query(`SELECT 1 AS pending FROM public.ai_usage_events WHERE tenant_id=$1 AND billable=true AND invoiced_at IS NULL
              AND (billing_batch IS NOT NULL OR occurred_at<=$2) LIMIT 1`, [id, now.toISOString()])
            if (eligible.rows.length) throw new AdminMenuError(503, 'Native AI invoice settlement is not available')
          }
        }
      }
      break
    }
    case 'invoice.payment_failed': {
      const subscription = invoiceSubscriptionId(value)
      if (!subscription) break
      const id = await subscriptionTenant(query, subscription)
      if (!id) break
      await lockTenant(query, id)
      const current = one((await query('SELECT tenant_id FROM public.tenant_subscriptions WHERE tenant_id=$1 AND stripe_subscription_id=$2 LIMIT 2 FOR UPDATE', [id, subscription])).rows)
      if (!current) throw new AdminMenuError(503, 'Subscription identity changed')
      await updateSubscription(query, id, { status: 'past_due' })
      await reconcileNativeTenantPlan(query, id)
      result.pendingSync = { tenantId: id, reason: 'past_due' }
      break
    }
    case 'account.updated': {
      const accountId = providerId(value.id)
      if (typeof value.charges_enabled !== 'boolean') throw new AdminMenuError(400, 'Invalid account state')
      const found = one((await query('SELECT id,tenant_id,is_active FROM public.stripe_connections WHERE stripe_account_id=$1 LIMIT 2', [accountId])).rows)
      if (!found) break
      const id = tenantId(found.tenant_id)
      await lockTenant(query, id)
      const current = one((await query('SELECT id,tenant_id,is_active FROM public.stripe_connections WHERE id=$1 AND tenant_id=$2 AND stripe_account_id=$3 LIMIT 2 FOR UPDATE', [found.id, id, accountId])).rows)
      if (!current) throw new AdminMenuError(503, 'Connected account identity changed')
      if (current.is_active !== value.charges_enabled) {
        await query('UPDATE public.stripe_connections SET is_active=$3 WHERE id=$1 AND tenant_id=$2 AND stripe_account_id=$4', [current.id, id, value.charges_enabled, accountId])
        if (!value.charges_enabled) result.disabledAccountId = accountId
      }
      result.pendingSync = { tenantId: id, reason: 'connect_changed' }
      break
    }
  }
  await query('INSERT INTO public.processed_stripe_events(event_id,event_type,processed_at) VALUES($1,$2,$3)', [event.id, event.type, now.toISOString()])
  return result
}
