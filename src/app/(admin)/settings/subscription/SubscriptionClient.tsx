'use client'

import { useState } from 'react'
import type { EffectivePlan } from '@/types/database'
import type { TenantSubscription } from '@/types/database'
import { CreditCard, CheckCircle2, Lock, Rocket, HelpCircle, ShieldCheck, Zap, Sparkles, ChevronRight, Info, AlertCircle, Calendar, RefreshCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SubscriptionClientProps {
  tenantId: string
  subscription: TenantSubscription | null
  plan: EffectivePlan | null
  stripeEnabled: boolean
  stripeAccountId: string | null
}

const ALL_FEATURES = [
  { key: 'menu', label: 'Digital Menu', description: 'Create and manage digital menus', icon: Zap },
  { key: 'orders', label: 'Order Management', description: 'Receive and manage orders', icon: Zap },
  { key: 'kds', label: 'Kitchen Display', description: 'Kitchen display system for orders', icon: Zap },
  { key: 'ingredients', label: 'Ingredient Customization', description: 'Allow customers to customize orders', icon: Zap },
  { key: 'stripe-connect', label: 'Stripe Payments', description: 'Accept payments via Stripe', icon: Sparkles },
  { key: 'ai-seeding', label: 'AI Menu Seeding', description: 'AI-powered menu creation', icon: Sparkles },
]

export default function SubscriptionClient({
  tenantId,
  subscription,
  plan,
  stripeEnabled,
  stripeAccountId,
}: SubscriptionClientProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>(
    subscription?.billing_cycle ?? 'monthly'
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleBillingCycleChange(newCycle: 'monthly' | 'annual') {
    if (newCycle === billingCycle) return

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/tenant/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_cycle: newCycle }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to update')
      }

      setBillingCycle(newCycle)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

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
                <span className="inline-flex items-center px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-zinc-950 text-white mb-4 shadow-lg shadow-zinc-950/10">
                  Current Tier
                </span>
                <h2 className="text-5xl font-black text-zinc-950 tracking-tighter leading-none mb-2">{plan.name}</h2>
                <p className="text-sm font-bold text-zinc-500">{plan.description}</p>
              </div>
              <div className="flex items-center gap-4 bg-zinc-50 p-6 rounded-[1rem] border border-zinc-100">
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Next Payout</p>
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
                  disabled={loading}
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
                  disabled={loading}
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

          {!isPaymentsPlan && (
            <section className="bg-zinc-950 rounded-[1.25rem] p-8 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px] -mr-32 -mt-32" />
              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-white/5 rounded-xl flex items-center justify-center mb-6 border border-white/10">
                  <Rocket className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-black text-white tracking-tight mb-2">Upgrade to Payments</h3>
                <p className="text-xs text-zinc-400 font-medium leading-relaxed mb-8">
                  Unlock Stripe payments, AI menu seeding, and advanced order analytics.
                </p>
                <button className="w-full py-4 bg-primary text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all active:scale-95 shadow-xl shadow-primary/20">
                  Contact Sales Agent
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