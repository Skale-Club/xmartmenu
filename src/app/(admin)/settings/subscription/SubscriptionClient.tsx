'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EffectivePlan } from '@/types/database'
import type { TenantSubscription } from '@/types/database'
import { CreditCard, CheckCircle2, Lock, Rocket, HelpCircle, ShieldCheck, Zap, Sparkles, ChevronRight, Info, AlertCircle, Calendar, RefreshCcw, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/** An active plan as listed on the subscription page (plans table, base prices). */
export interface PlanOption {
  id: string
  name: string
  slug: string
  description: string | null
  monthly_price: number
  annual_price: number
  features: string[]
  sort_order: number
}

interface SubscriptionClientProps {
  tenantId: string
  subscription: TenantSubscription | null
  plan: EffectivePlan | null
  plans: PlanOption[]
  /** Owner / superadmin: may change plan and billing. Staff see the page read-only. */
  canManage: boolean
  /** ?plan=success|cancelled after returning from Stripe Checkout. */
  checkoutResult: 'success' | 'cancelled' | null
  stripeEnabled: boolean
  stripeAccountId: string | null
}

// Keys as they are in plans.features (the seeded Digital Menu / Menu + Orders /
// Menu + Payments plans); orders and payments are the ones that unlock the
// waiter and self-service modes (src/lib/service-modes.ts).
const ALL_FEATURES = [
  { key: 'digital-menu', label: 'Digital Menu', description: 'Create and manage digital menus', icon: Zap },
  { key: 'qr-code', label: 'QR Codes', description: 'QR codes and links for tables, NFC tags and social media', icon: Zap },
  { key: 'analytics', label: 'Menu Analytics', description: 'Most viewed dishes, funnel and conversion', icon: Zap },
  { key: 'orders', label: 'Waiter Ordering', description: 'Staff take orders at the table in the waiter app', icon: Zap },
  { key: 'payments', label: 'Guest Ordering & Payment', description: 'Guests order and pay from the menu, served at their table', icon: Sparkles },
  { key: 'stripe-connect', label: 'Stripe Payments', description: 'Accept card, Apple Pay and Google Pay via Stripe', icon: Sparkles },
]

const STATUS_LABELS: Record<TenantSubscription['status'], string> = {
  active: 'Active',
  trial: 'Trial',
  past_due: 'Past due',
  cancelled: 'Cancelled',
}

const STATUS_BADGES: Record<TenantSubscription['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  trial: 'bg-sky-100 text-sky-700',
  past_due: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function SubscriptionClient({
  tenantId,
  subscription,
  plan,
  plans,
  canManage,
  checkoutResult,
  stripeEnabled,
  stripeAccountId,
}: SubscriptionClientProps) {
  const router = useRouter()
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>(
    subscription?.billing_cycle ?? 'monthly'
  )
  const [loading, setLoading] = useState(false)
  // Which plan card started the request, so only that button shows "Loading…".
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(
    checkoutResult === 'success' ? 'Payment received. Your plan is being activated…' : null
  )
  const [success, setSuccess] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => { cancelled.current = true }
  }, [])

  // Back from Stripe Checkout: the webhook activates the plan a moment later,
  // so re-read the page a few times instead of showing the old state.
  useEffect(() => {
    if (checkoutResult !== 'success') return
    const timers = [2000, 5000, 9000].map(ms => setTimeout(() => router.refresh(), ms))
    return () => timers.forEach(clearTimeout)
  }, [checkoutResult, router])

  // After a plan / cycle change on an existing Stripe subscription the webhook
  // mirrors it into our database a moment later: poll until the new state is
  // there (or give up gracefully), then refresh the server-rendered page.
  async function waitForSubscription(planId: string, cycle: 'monthly' | 'annual') {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1500))
      if (cancelled.current) return
      try {
        const res = await fetch('/api/tenant/subscription', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          if (data?.plan?.id === planId && data?.subscription?.billing_cycle === cycle) break
        }
      } catch {
        // Keep polling; the final refresh below shows whatever state is there.
      }
    }
    if (!cancelled.current) router.refresh()
  }

  async function handleBillingCycleChange(newCycle: 'monthly' | 'annual') {
    if (newCycle === billingCycle || !canManage) return

    // On a live Stripe subscription this is a real, prorated billing change.
    if (hasActiveBilling && !window.confirm(`Switch to ${newCycle} billing? Stripe prorates the change on your next invoice.`)) return

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/tenant/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_cycle: newCycle }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data.error ?? 'Failed to update')

      setBillingCycle(newCycle)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      if (data.pending && plan) void waitForSubscription(plan.id, newCycle)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // Real billing actions. Every upgrade / switch / reactivation posts the plan
  // it wants: Checkout starts a Stripe Subscription (new or ended billing),
  // while a tenant that already pays has its subscription changed in place.
  // The portal lets a subscribed tenant fix the card or cancel.
  async function choosePlan(planId: string) {
    if (!canManage) return
    setLoading(true)
    setPendingPlanId(planId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/tenant/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, billing_cycle: billingCycle }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to start checkout')
      if (data.url) {
        window.location.assign(data.url)
        return
      }
      if (data.updated) {
        setNotice(data.changed === false ? 'You are already on that plan.' : 'Plan change submitted. It shows up here in a few seconds.')
        setLoading(false)
        setPendingPlanId(null)
        if (data.changed !== false) await waitForSubscription(planId, billingCycle)
        setNotice(null)
        return
      }
      throw new Error('Failed to start checkout')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
      setPendingPlanId(null)
    }
  }

  async function openPortal() {
    if (!canManage) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tenant/subscription/portal', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Failed to open billing portal')
      window.location.assign(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  function choosePlanWithConfirm(target: PlanOption) {
    const currentOrder = plans.find(p => p.id === plan?.id)?.sort_order ?? 0
    if (isLive && target.sort_order < currentOrder) {
      const confirmed = window.confirm(
        `Switch to ${target.name}? The change is immediate: anything your current plan includes that ${target.name} does not (ordering, tables, tips, delivery…) is switched off.`
      )
      if (!confirmed) return
    }
    void choosePlan(target.id)
  }

  const hasActiveBilling = !!subscription?.stripe_subscription_id
  const status = subscription?.status ?? 'active'
  const isLive = status === 'active' || status === 'trial'
  const periodEnd = formatDate(subscription?.current_period_end)

  function hasFeature(featureKey: string): boolean {
    return plan?.features.includes(featureKey) ?? false
  }

  if (!subscription || !plan) {
    return (
      <div className="p-8 w-full min-h-[70vh] flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 bg-zinc-50 rounded-[1rem] flex items-center justify-center mb-8 shadow-sm">
          <CreditCard className="w-10 h-10 text-zinc-200" />
        </div>
        <h1 className="text-4xl font-black text-zinc-950 tracking-tight mb-2">No Active Subscription</h1>
        <p className="text-zinc-500 font-medium mb-8 max-w-sm">You don't have an active plan. Link your account to get started with XmartMenu.</p>
        <button className="bg-zinc-950 text-white px-10 py-5 rounded-full text-sm font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all shadow-xl shadow-zinc-950/10 flex items-center gap-2">
          Contact Enterprise Support
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    )
  }

  const isPaymentsPlan = plan.slug === 'payments'
  const paymentsPlan = plans.find(p => p.slug === 'payments') ?? null
  const currentOrder = plans.find(p => p.id === plan.id)?.sort_order ?? 0

  return (
    <div className="p-8 w-full space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Rocket className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Power Center</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Subscription</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Manage your active plan and operational limits</p>
        </div>
      </div>

      {/* Cancelled / past due: paid features are off, with the way back. */}
      {status === 'cancelled' && (
        <div role="alert" className="bg-red-50 border border-red-100 rounded-[1rem] px-8 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-black text-red-700">Your subscription is cancelled</p>
              <p className="text-sm font-medium text-red-700/80 mt-1">
                Paid features are off: ordering, tables, tips, delivery and payments are not available and your menu is shown as a digital menu only.
                Reactivate {plan.name} to get them back, then switch your ordering options on again in Settings.
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => choosePlan(plan.id)}
              disabled={loading}
              className="shrink-0 px-6 py-3 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-all disabled:opacity-50"
            >
              {loading && pendingPlanId === plan.id ? 'Redirecting…' : `Reactivate ${plan.name}`}
            </button>
          )}
        </div>
      )}

      {status === 'past_due' && (
        <div role="alert" className="bg-amber-50 border border-amber-100 rounded-[1rem] px-8 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-black text-amber-800">Your last payment failed</p>
              <p className="text-sm font-medium text-amber-800/80 mt-1">
                Paid features are paused until the payment goes through: ordering, tables, tips, delivery and payments are not available meanwhile.
                {hasActiveBilling ? ' Update your payment method to restore them.' : ' Reactivate your plan to restore them.'}
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={hasActiveBilling ? openPortal : () => choosePlan(plan.id)}
              disabled={loading}
              className="shrink-0 px-6 py-3 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition-all disabled:opacity-50"
            >
              {loading ? 'Loading…' : hasActiveBilling ? 'Update payment method' : `Reactivate ${plan.name}`}
            </button>
          )}
        </div>
      )}

      {status === 'trial' && (
        <div className="bg-sky-50 border border-sky-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-sky-800 flex items-center gap-3 shadow-sm">
          <Info className="w-5 h-5 shrink-0" />
          You are on a trial of {plan.name}{periodEnd ? ` until ${periodEnd}` : ''}.
        </div>
      )}

      {!canManage && (
        <div className="bg-zinc-50 border border-zinc-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-zinc-600 flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0" />
          Only the restaurant owner can change the plan or billing.
        </div>
      )}

      {checkoutResult === 'cancelled' && (
        <div className="bg-zinc-50 border border-zinc-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-zinc-600">
          Checkout was cancelled. Nothing was charged.
        </div>
      )}

      {notice && (
        <div role="status" className="bg-sky-50 border border-sky-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-sky-800 flex items-center gap-3 shadow-sm">
          <RefreshCcw className="w-5 h-5 shrink-0" />
          {notice}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-red-600 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="p-2 hover:bg-red-100 rounded-full transition-colors">✕</button>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-green-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5" />
            Billing cycle updated successfully!
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Plan Overview */}
        <div className="lg:col-span-2 space-y-10">
          <section className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -mr-32 -mt-32 transition-opacity group-hover:opacity-100 opacity-50" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="inline-flex items-center px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-zinc-950 text-white shadow-lg shadow-zinc-950/10">
                    Current Tier
                  </span>
                  <span className={cn('inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest', STATUS_BADGES[status])}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
                <h2 className="text-5xl font-black text-zinc-950 tracking-tighter leading-none mb-2">{plan.name}</h2>
                <p className="text-sm font-bold text-zinc-500">{plan.description}</p>
                {subscription.cancel_at_period_end && isLive && (
                  <p className="text-xs font-bold text-amber-700 mt-3">
                    Cancellation scheduled{periodEnd ? `: your plan ends on ${periodEnd}` : ' at the end of the current period'}.
                  </p>
                )}
                {!subscription.cancel_at_period_end && isLive && hasActiveBilling && periodEnd && (
                  <p className="text-xs font-bold text-zinc-400 mt-3">Renews on {periodEnd}</p>
                )}
              </div>
              <div className="flex items-center gap-4 bg-zinc-50 p-6 rounded-[1rem] border border-zinc-100">
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Plan Price</p>
                  <p className="text-2xl font-black text-zinc-950 tracking-tighter">R$ {billingCycle === 'monthly' ? plan.monthly_price : plan.annual_price}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
                  <Calendar className="w-5 h-5" />
                </div>
              </div>
            </div>

            <div className="relative z-10 border-t border-zinc-50 pt-10">
              <div className="flex items-center gap-3 mb-6">
                <RefreshCcw className="w-4 h-4 text-zinc-400" />
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Select Billing Cycle</label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => handleBillingCycleChange('monthly')}
                  disabled={loading || !canManage}
                  className={cn(
                    "group relative py-6 px-8 rounded-xl border-2 transition-all active:scale-[0.98]",
                    billingCycle === 'monthly'
                      ? "border-zinc-950 bg-zinc-950 text-white shadow-2xl shadow-zinc-950/20"
                      : "border-zinc-100 bg-white text-zinc-400 hover:border-zinc-300"
                  )}
                >
                  <div className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Monthly</div>
                  <div className="text-2xl font-black tracking-tighter">
                    R$ {plan.monthly_price}
                    <span className="text-xs font-bold opacity-60 ml-1">/mo</span>
                  </div>
                  {billingCycle === 'monthly' && <CheckCircle2 className="absolute top-4 right-4 w-5 h-5 text-primary" />}
                </button>
                <button
                  onClick={() => handleBillingCycleChange('annual')}
                  disabled={loading || !canManage}
                  className={cn(
                    "group relative py-6 px-8 rounded-xl border-2 transition-all active:scale-[0.98]",
                    billingCycle === 'annual'
                      ? "border-zinc-950 bg-zinc-950 text-white shadow-2xl shadow-zinc-950/20"
                      : "border-zinc-100 bg-white text-zinc-400 hover:border-zinc-300"
                  )}
                >
                  <div className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Annual</div>
                  <div className="text-2xl font-black tracking-tighter">
                    R$ {plan.annual_price}
                    <span className="text-xs font-bold opacity-60 ml-1">/yr</span>
                  </div>
                  <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest">
                    Save {Math.round((1 - plan.annual_price / (plan.monthly_price * 12)) * 100)}%
                  </div>
                  {billingCycle === 'annual' && <CheckCircle2 className="absolute top-4 right-4 w-5 h-5 text-primary" />}
                </button>
              </div>
            </div>

            {/* Real billing action: subscribe (Stripe Checkout) or manage (Stripe Portal). */}
            {canManage && (
              <div className="relative z-10 mt-8">
                {hasActiveBilling ? (
                  <button
                    onClick={openPortal}
                    disabled={loading}
                    className="w-full py-4 bg-zinc-950 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all shadow-xl shadow-zinc-950/10 disabled:opacity-50"
                  >
                    {loading && !pendingPlanId ? 'Loading…' : 'Manage Subscription'}
                  </button>
                ) : (
                  <button
                    onClick={() => choosePlan(plan.id)}
                    disabled={loading}
                    className="w-full py-4 bg-primary text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-950 hover:text-white transition-all shadow-xl shadow-primary/20 disabled:opacity-50"
                  >
                    {loading && pendingPlanId === plan.id ? 'Redirecting…' : `Subscribe — ${billingCycle === 'monthly' ? 'Monthly' : 'Annual'}`}
                  </button>
                )}
              </div>
            )}

            {isPaymentsPlan && (
              <div className="relative z-10 bg-zinc-50 rounded-xl p-4 mt-8 flex items-center justify-between border border-zinc-100">
                <div className="flex items-center gap-3">
                  <Info className="w-4 h-4 text-zinc-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Service Fee Percentage</span>
                </div>
                <span className="text-sm font-black text-zinc-950">{plan.transaction_fee_pct}%</span>
              </div>
            )}
          </section>

          {/* Plan picker: every upgrade / switch posts the chosen plan_id. */}
          {plans.length > 0 && (
            <section className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 shadow-sm">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-zinc-950 tracking-tight">Choose Your Plan</h3>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                    Prices shown {billingCycle === 'monthly' ? 'per month' : 'per year'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {plans.map(option => {
                  const isCurrent = option.id === plan.id
                  const price = isCurrent
                    ? (billingCycle === 'monthly' ? plan.monthly_price : plan.annual_price)
                    : (billingCycle === 'monthly' ? option.monthly_price : option.annual_price)
                  const isUpgrade = option.sort_order > currentOrder
                  const busy = loading && pendingPlanId === option.id
                  const included = ALL_FEATURES.filter(f => option.features.includes(f.key))
                  return (
                    <div
                      key={option.id}
                      className={cn(
                        'relative flex flex-col rounded-xl border-2 p-6 transition-all',
                        isCurrent ? 'border-zinc-950 bg-zinc-50 shadow-lg shadow-zinc-950/5' : 'border-zinc-100 bg-white'
                      )}
                    >
                      {isCurrent && (
                        <span className="absolute -top-3 left-6 inline-flex items-center px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-zinc-950 text-white">
                          Current plan
                        </span>
                      )}
                      <h4 className="text-lg font-black text-zinc-950 tracking-tight">{option.name}</h4>
                      <p className="text-2xl font-black text-zinc-950 tracking-tighter mt-2">
                        R$ {price}
                        <span className="text-xs font-bold text-zinc-400 ml-1">{billingCycle === 'monthly' ? '/mo' : '/yr'}</span>
                      </p>
                      {option.description && <p className="text-xs font-medium text-zinc-500 mt-2">{option.description}</p>}
                      <ul className="mt-4 space-y-2 flex-1">
                        {included.map(f => (
                          <li key={f.key} className="flex items-start gap-2 text-xs font-bold text-zinc-700">
                            <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                            {f.label}
                          </li>
                        ))}
                      </ul>
                      {canManage && (
                        <button
                          onClick={() => (isCurrent ? choosePlan(option.id) : choosePlanWithConfirm(option))}
                          disabled={loading || (isCurrent && isLive)}
                          className={cn(
                            'mt-6 w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50',
                            isCurrent && isLive
                              ? 'bg-zinc-100 text-zinc-400 cursor-default'
                              : isUpgrade || isCurrent
                                ? 'bg-primary text-primary-foreground hover:bg-zinc-950 hover:text-white shadow-lg shadow-primary/20'
                                : 'bg-zinc-950 text-white hover:bg-primary hover:text-primary-foreground'
                          )}
                        >
                          {busy
                            ? 'Loading…'
                            : isCurrent
                              ? (isLive ? 'Current plan' : `Reactivate ${option.name}`)
                              : isUpgrade ? `Upgrade to ${option.name}` : `Switch to ${option.name}`}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              {hasActiveBilling && canManage && (
                <p className="text-[10px] font-bold text-zinc-400 mt-6 leading-relaxed">
                  Changing plan updates your existing Stripe subscription; the price difference is prorated on your next invoice.
                </p>
              )}
            </section>
          )}

          {/* Feature Breakdown */}
          <section className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 shadow-sm">
            <div className="flex items-center gap-3 mb-10">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-zinc-950 tracking-tight">Capabilities Matrix</h3>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Available tools for your operations</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <p className="text-[10px] font-black text-zinc-950 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  Active In Plan
                </p>
                {ALL_FEATURES.filter(f => hasFeature(f.key)).map(feature => {
                  const Icon = feature.icon
                  return (
                    <div key={feature.key} className="flex gap-4 p-5 rounded-xl bg-zinc-50 border border-zinc-100 group hover:border-primary/30 transition-all">
                      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-primary shadow-sm">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-black text-zinc-950 uppercase tracking-tight">{feature.label}</div>
                        <div className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">{feature.description}</div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-4 opacity-60 grayscale group-hover:grayscale-0 transition-all">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5" />
                  Upgrade to Unlock
                </p>
                {ALL_FEATURES.filter(f => !hasFeature(f.key)).map(feature => {
                  const Icon = feature.icon
                  return (
                    <div key={feature.key} className="flex gap-4 p-5 rounded-xl border border-dashed border-zinc-200">
                      <div className="w-10 h-10 rounded-xl bg-zinc-50 flex items-center justify-center text-zinc-300">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-black text-zinc-400 uppercase tracking-tight">{feature.label}</div>
                        <div className="text-[10px] text-zinc-400 font-medium leading-relaxed mt-0.5">{feature.description}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar Status */}
        <div className="lg:col-span-1 space-y-10">
          {isPaymentsPlan && (
            <section className="bg-white border border-zinc-100 rounded-[1.25rem] p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-black text-zinc-950 tracking-tight">Fintech Pipeline</h3>
              </div>

              {stripeEnabled ? (
                <div className="space-y-6">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Active Connection</span>
                    </div>
                    <p className="text-sm font-bold text-emerald-950 leading-relaxed">
                      Your business is successfully linked to Stripe for instant payouts.
                    </p>
                  </div>
                  <p className="text-[10px] font-bold text-zinc-400 text-center uppercase tracking-widest">Linked ID: {stripeAccountId?.slice(0, 10)}***</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Action Required</span>
                    </div>
                    <p className="text-sm font-bold text-amber-950 leading-relaxed">
                      Accept online payments by connecting your store to Stripe.
                    </p>
                  </div>
                  <a
                    href="/settings/store"
                    className="flex items-center justify-center gap-2 w-full py-4 bg-zinc-950 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all shadow-xl shadow-zinc-950/10"
                  >
                    Sync Stripe Pipeline
                  </a>
                </div>
              )}
            </section>
          )}

          {!isPaymentsPlan && paymentsPlan && canManage && (
            <section className="bg-zinc-950 rounded-[1.25rem] p-8 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px] -mr-32 -mt-32" />
              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-white/5 rounded-xl flex items-center justify-center mb-6 border border-white/10">
                  <Rocket className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-black text-white tracking-tight mb-2">Upgrade to {paymentsPlan.name}</h3>
                <p className="text-xs text-zinc-400 font-medium leading-relaxed mb-8">
                  Let guests order and pay from the menu with Stripe, and unlock advanced order analytics.
                </p>
                <button
                  onClick={() => choosePlan(paymentsPlan.id)}
                  disabled={loading}
                  className="w-full py-4 bg-primary text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all active:scale-95 shadow-xl shadow-primary/20 disabled:opacity-50"
                >
                  {loading && pendingPlanId === paymentsPlan.id ? 'Loading…' : `Upgrade to ${paymentsPlan.name}`}
                </button>
              </div>
            </section>
          )}

          <section className="bg-zinc-50 rounded-[1.25rem] p-8 border border-zinc-100">
            <div className="flex items-center gap-3 mb-4">
              <HelpCircle className="w-5 h-5 text-zinc-400" />
              <h3 className="text-sm font-black text-zinc-950 uppercase tracking-tight">Billing FAQ</h3>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-black text-zinc-950 uppercase tracking-widest mb-1">When will I be charged?</p>
                <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">Subscriptions are processed at the start of your billing cycle.</p>
              </div>
              <div className="pt-4 border-t border-zinc-100">
                <p className="text-[10px] font-black text-zinc-950 uppercase tracking-widest mb-1">What happens when I change plan?</p>
                <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">Upgrades start right away and the difference is prorated. A downgrade switches off the options the new plan does not include.</p>
              </div>
              <div className="pt-4 border-t border-zinc-100">
                <p className="text-[10px] font-black text-zinc-950 uppercase tracking-widest mb-1">Can I cancel anytime?</p>
                <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">Yes, your plan will remain active until the end of the current period.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
