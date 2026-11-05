import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { normalizeRole } from '../auth/role-utils'
import { readNativeTenantPlan, reconcileNativeTenantPlan } from './tenant-plan'
import { readNativeStripeAvailability } from './stripe-connect'
import { enqueueNativeTenantEffect } from './tenant-effects-outbox'
import type { UserRole, TenantSubscription } from '@/types/database'
import type { BillingCycle } from '../plan-billing'

export interface SubscriptionActor { actorId: string; tenantId: string; role: UserRole; sessionHash: string }
export type SubscriptionView = Pick<TenantSubscription, 'billing_cycle' | 'status' | 'stripe_subscription_id' | 'current_period_end' | 'cancel_at_period_end'>
export interface SubscriptionPlanOption { id: string; name: string; slug: string; description: string | null; monthly_price: number; annual_price: number; features: string[]; sort_order: number }
export interface BillingPlan { id: string; slug: string; is_active: boolean; stripe_price_monthly_id: string | null; stripe_price_annual_id: string | null }
export interface SubscriptionRecord { raw: Record<string, unknown>; id: string; tenantId: string; planId: string; cycle: BillingCycle; status: string; customerId: string | null; subscriptionId: string | null; view: SubscriptionView }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const billingUnavailable = () => new AdminMenuError(503, 'Subscription service is unavailable')
export const providerId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(value)
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const one = (rows: Record<string, unknown>[]) => { if (rows.length > 1) throw billingUnavailable(); return rows[0] }
const id = (value: unknown): string => { if (typeof value !== 'string' || !UUID.test(value)) throw billingUnavailable(); return value }
const reference = (value: unknown): string | null => { if (value == null || value === '') return null; if (!providerId(value)) throw billingUnavailable(); return value }
const number = (value: unknown) => { if (typeof value !== 'number' || !Number.isFinite(value)) throw billingUnavailable(); return value }
export async function authorizeSubscription(query: AdminMenuQuery, context: SubscriptionActor, write = false, superadmin = false) {
  id(context.actorId); id(context.tenantId)
  if (!/^[a-f0-9]{64}$/.test(context.sessionHash)) throw new AdminMenuError(403, 'Forbidden')
  if (!['store-admin', 'superadmin', ...(write ? [] : ['store-staff'])].includes(context.role) || (superadmin && context.role !== 'superadmin')) throw new AdminMenuError(403, 'Forbidden')
  if (write) await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
  const result = await query(`SELECT p.id,p.role,p.tenant_id,p.must_change_password,a.disabled_at
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id JOIN public.app_sessions s ON s.user_id=a.id
    JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=s.project_id AND b.subject=s.subject
    WHERE p.id=$1 AND s.token_hash=$2 AND s.session_version=a.session_version AND s.expires_at>now()
      AND b.disabled_at IS NULL${write ? ' FOR SHARE OF p,a,s,b' : ''}`, [context.actorId, context.sessionHash])
  const profile = one(result.rows), role = normalizeRole(profile?.role)
  if (!profile || role !== context.role || profile.disabled_at !== null || profile.must_change_password === true || (role !== 'superadmin' && profile.tenant_id !== context.tenantId)) throw new AdminMenuError(403, 'Forbidden')
  if (write && !(await query('SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE', [context.tenantId])).rows.length) throw new AdminMenuError(404, 'Tenant not found')
}
export async function readSubscriptionRecord(query: AdminMenuQuery, tenantId: string, lock = false): Promise<SubscriptionRecord | null> {
  const selected = one((await query(`SELECT to_jsonb(s) AS subscription FROM public.tenant_subscriptions s WHERE tenant_id=$1 LIMIT 2${lock ? ' FOR UPDATE' : ''}`, [id(tenantId)])).rows)
  if (!selected) return null
  const raw = object(selected.subscription)
  if (!raw || raw.tenant_id !== tenantId || !['monthly','annual'].includes(String(raw.billing_cycle)) || !['active','trial','past_due','cancelled'].includes(String(raw.status))
    || typeof raw.cancel_at_period_end !== 'boolean' || (raw.current_period_end !== null && typeof raw.current_period_end !== 'string')) throw billingUnavailable()
  const cycle = raw.billing_cycle as BillingCycle, status = raw.status as TenantSubscription['status'], subscriptionId = reference(raw.stripe_subscription_id)
  return { raw, id: id(raw.id), tenantId, planId: id(raw.plan_id), cycle, status, customerId: reference(raw.stripe_customer_id), subscriptionId,
    view: { billing_cycle: cycle, status, stripe_subscription_id: subscriptionId, current_period_end: raw.current_period_end as string | null, cancel_at_period_end: raw.cancel_at_period_end } }
}
export async function readBillingPlan(query: AdminMenuQuery, planId: string, lock = false): Promise<BillingPlan | null> {
  const row = one((await query(`SELECT id,slug,is_active,stripe_price_monthly_id,stripe_price_annual_id FROM public.plans WHERE id=$1 LIMIT 2${lock ? ' FOR SHARE' : ''}`, [id(planId)])).rows)
  if (!row) return null
  if (typeof row.slug !== 'string' || typeof row.is_active !== 'boolean') throw billingUnavailable()
  return { id: id(row.id), slug: row.slug, is_active: row.is_active, stripe_price_monthly_id: reference(row.stripe_price_monthly_id), stripe_price_annual_id: reference(row.stripe_price_annual_id) }
}
/** A checkout for a tenant without a row must have a non-entitled target for
 * the existing lifecycle webhook to update; never grant a paid plan early. */
export async function ensureCheckoutSubscription(query: AdminMenuQuery, context: SubscriptionActor, planId: string, cycle: BillingCycle) {
  const snapshot = await subscriptionSnapshot(query, context, true)
  if (snapshot.subscription) return snapshot
  const plan = await readBillingPlan(query, planId, true)
  if (!plan?.is_active) throw new AdminMenuError(400, 'That plan is no longer available.')
  await query("INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$2,$3,'cancelled')", [context.tenantId, planId, cycle])
  return subscriptionSnapshot(query, context, true)
}
export async function subscriptionSnapshot(query: AdminMenuQuery, context: SubscriptionActor, write = false, superadmin = false) {
  await authorizeSubscription(query, context, write, superadmin)
  const tenant = one((await query('SELECT id,slug FROM public.tenants WHERE id=$1 LIMIT 2', [context.tenantId])).rows)
  if (!tenant || typeof tenant.slug !== 'string') throw new AdminMenuError(404, 'Tenant not found')
  const subscription = await readSubscriptionRecord(query, context.tenantId, write)
  return { tenantId: context.tenantId, slug: tenant.slug, subscription }
}
export async function readSubscriptionPage(query: AdminMenuQuery, context: SubscriptionActor) {
  const snapshot = await subscriptionSnapshot(query, context)
  const rows = (await query(`SELECT id,name,slug,description,monthly_price::float8,annual_price::float8,features,sort_order FROM public.plans WHERE is_active=true ORDER BY sort_order LIMIT 1001`)).rows
  if (rows.length > 1000) throw billingUnavailable()
  const plans: SubscriptionPlanOption[] = rows.map(row => {
    if (typeof row.name !== 'string' || typeof row.slug !== 'string' || !Array.isArray(row.features) || row.features.some(value => typeof value !== 'string')) throw billingUnavailable()
    return { id: id(row.id), name: row.name, slug: row.slug, description: typeof row.description === 'string' ? row.description : null, monthly_price: number(row.monthly_price), annual_price: number(row.annual_price), features: row.features, sort_order: number(row.sort_order) }
  })
  const plan = await readNativeTenantPlan(query, context.tenantId), stripe = await readNativeStripeAvailability(query, context.tenantId)
  return { subscription: snapshot.subscription?.view ?? null, plan, plans, stripeEnabled: stripe.feature && !!stripe.connection, stripeAccountId: stripe.connection?.stripe_account_id ?? null }
}
export async function readSubscriptionApi(query: AdminMenuQuery, context: SubscriptionActor) {
  const snapshot = await subscriptionSnapshot(query, context)
  if (!snapshot.subscription) return { subscription: null, plan: null, features: [], stripeEnabled: false, stripeAccountId: null }
  const raw = snapshot.subscription.raw, plan = await readNativeTenantPlan(query, context.tenantId), stripe = await readNativeStripeAvailability(query, context.tenantId)
  return { subscription: { id: raw.id, billing_cycle: raw.billing_cycle, status: raw.status, current_period_start: raw.current_period_start, current_period_end: raw.current_period_end, cancel_at_period_end: raw.cancel_at_period_end }, plan, features: plan?.features ?? [], stripeEnabled: stripe.feature && !!stripe.connection, stripeAccountId: stripe.connection?.stripe_account_id ?? null }
}
export async function readSuperSubscription(query: AdminMenuQuery, context: SubscriptionActor) {
  const snapshot = await subscriptionSnapshot(query, context, false, true)
  if (!snapshot.subscription) return { id: null, tenant_id: context.tenantId, plan_id: null, billing_cycle: 'monthly', status: 'active', override_monthly_price: null, override_annual_price: null, override_transaction_fee_pct: null, override_notes: null, stripe_customer_id: null, stripe_subscription_id: null, current_period_start: null, current_period_end: null, plan: null }
  return joinedSubscription(query, snapshot.subscription)
}
async function joinedSubscription(query: AdminMenuQuery, subscription: SubscriptionRecord) {
  const row = one((await query('SELECT to_jsonb(p) AS plan FROM public.plans p WHERE id=$1 LIMIT 2', [subscription.planId])).rows)
  return { ...subscription.raw, id: subscription.id, plan: row?.plan ?? null }
}
export type SubscriptionPatch = { plan_id?: string; billing_cycle?: BillingCycle; status?: string; override_monthly_price?: number | null; override_annual_price?: number | null; override_transaction_fee_pct?: number | null; override_notes?: string | null }
export function validateSubscriptionPatch(body: unknown): SubscriptionPatch {
  const input = object(body)
  if (!input) throw new AdminMenuError(400, 'Invalid request body')
  const patch: SubscriptionPatch = {}
  if (input.plan_id !== undefined) { if (typeof input.plan_id !== 'string' || !UUID.test(input.plan_id)) throw new AdminMenuError(400, 'Selected plan was not found or is inactive'); patch.plan_id = input.plan_id }
  if (input.billing_cycle !== undefined) { if (input.billing_cycle !== 'monthly' && input.billing_cycle !== 'annual') throw new AdminMenuError(400, 'Billing cycle must be monthly or annual'); patch.billing_cycle = input.billing_cycle }
  if (input.status !== undefined) { if (typeof input.status !== 'string' || !['active','trial','past_due','cancelled'].includes(input.status)) throw new AdminMenuError(400, 'Status must be active, trial, past_due or cancelled'); patch.status = input.status }
  for (const key of ['override_monthly_price','override_annual_price','override_transaction_fee_pct'] as const) {
    if (input[key] !== undefined) { const value = input[key]; if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key === 'override_transaction_fee_pct' && value > 100))) throw new AdminMenuError(400, 'Invalid billing override'); patch[key] = value as number | null }
  }
  if (input.override_notes !== undefined) { if (input.override_notes !== null && typeof input.override_notes !== 'string') throw new AdminMenuError(400, 'Invalid billing notes'); patch.override_notes = input.override_notes as string | null }
  if (!Object.keys(patch).length) throw new AdminMenuError(400, 'No valid fields to update')
  return patch
}
/** Called after provider decisions, inside a fresh authorized write transaction. */
export async function writeSubscriptionPatch(query: AdminMenuQuery, context: SubscriptionActor, patch: SubscriptionPatch, current: SubscriptionRecord | null, recordSync = false, eventId?: string) {
  patch = validateSubscriptionPatch(patch)
  await authorizeSubscription(query, context, true, Object.keys(patch).some(key => key !== 'billing_cycle'))
  if (patch.plan_id) {
    const plan = await readBillingPlan(query, patch.plan_id, true)
    if (!plan?.is_active) throw new AdminMenuError(400, 'Selected plan was not found or is inactive')
  }
  const keys = Object.keys(patch), values = Object.values(patch)
  if (current) await query(`UPDATE public.tenant_subscriptions SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')} WHERE tenant_id=$1`, [context.tenantId, ...values])
  else {
    if (!patch.plan_id) throw new AdminMenuError(400, 'Select a plan before editing billing details.')
    await query(`INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status,override_monthly_price,override_annual_price,override_transaction_fee_pct,override_notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [context.tenantId, patch.plan_id, patch.billing_cycle ?? 'monthly', patch.status ?? 'active', patch.override_monthly_price ?? null, patch.override_annual_price ?? null, patch.override_transaction_fee_pct ?? null, patch.override_notes ?? null])
  }
  await reconcileNativeTenantPlan(query, context.tenantId)
  const updated = await readSubscriptionRecord(query, context.tenantId)
  if (!updated) throw billingUnavailable()
  if (recordSync && context.role === 'superadmin') await enqueueNativeTenantEffect(query, { tenantId: context.tenantId, reason: current ? 'plan_changed' : 'plan_activated', ...(eventId ? { eventId } : {}) })
  return joinedSubscription(query, updated)
}
