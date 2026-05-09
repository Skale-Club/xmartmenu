'use client'

import { useState } from 'react'
import type { EffectivePlan } from '@/types/database'
import type { TenantSubscription } from '@/types/database'

interface SubscriptionClientProps {
  tenantId: string
  subscription: TenantSubscription | null
  plan: EffectivePlan | null
  stripeEnabled: boolean
  stripeAccountId: string | null
}

// All available features - in order of plan value
const ALL_FEATURES = [
  { key: 'menu', label: 'Digital Menu', description: 'Create and manage digital menus' },
  { key: 'orders', label: 'Order Management', description: 'Receive and manage orders' },
  { key: 'kds', label: 'Kitchen Display', description: 'Kitchen display system for orders' },
  { key: 'ingredients', label: 'Ingredient Customization', description: 'Allow customers to customize orders' },
  { key: 'stripe-connect', label: 'Stripe Payments', description: 'Accept payments via Stripe' },
  { key: 'ai-seeding', label: 'AI Menu Seeding', description: 'AI-powered menu creation' },
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

  // Handle billing cycle change
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

  // Check if feature is included in current plan
  function hasFeature(featureKey: string): boolean {
    return plan?.features.includes(featureKey) ?? false
  }

  // Handle no subscription
  if (!subscription || !plan) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold text-zinc-900 mb-6">Subscription</h1>
        
        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-6 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-2">No Active Subscription</h2>
          <p className="text-zinc-500 mb-4">
            You don't have an active subscription. Contact support to get started.
          </p>
          <button className="px-4 py-2 bg-zinc-900 text-white rounded-lg font-medium hover:bg-zinc-800 transition-colors">
            Contact Support
          </button>
        </div>
      </div>
    )
  }

  const isPaymentsPlan = plan.slug === 'payments'

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900">Subscription</h1>

      {/* Current Plan Card */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-900 text-white mb-2">
              Current Plan
            </span>
            <h2 className="text-xl font-bold text-zinc-900">{plan.name}</h2>
            <p className="text-sm text-zinc-500 mt-1">{plan.description}</p>
          </div>
        </div>

        <div className="border-t border-zinc-100 pt-4 mt-4">
          <label className="block text-sm font-medium text-zinc-700 mb-2">
            Billing Cycle
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => handleBillingCycleChange('monthly')}
              disabled={loading}
              className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                billingCycle === 'monthly'
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
              }`}
            >
              <div className="text-sm">Monthly</div>
              <div className="text-lg font-bold">
                R$ {plan.monthly_price}
                <span className="text-sm font-normal">/mês</span>
              </div>
            </button>
            <button
              onClick={() => handleBillingCycleChange('annual')}
              disabled={loading}
              className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                billingCycle === 'annual'
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
              }`}
            >
              <div className="text-sm">Annual</div>
              <div className="text-lg font-bold">
                R$ {plan.annual_price}
                <span className="text-sm font-normal">/ano</span>
              </div>
              <div className="text-xs text-emerald-600 font-medium">
                Save {Math.round((1 - plan.annual_price / (plan.monthly_price * 12)) * 100)}%
              </div>
            </button>
          </div>

          {error && (
            <p className="text-red-600 text-sm mt-2">{error}</p>
          )}
          {success && (
            <p className="text-emerald-600 text-sm mt-2">Billing cycle updated!</p>
          )}
        </div>

        {isPaymentsPlan && (
          <div className="border-t border-zinc-100 pt-4 mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600">Transaction Fee</span>
              <span className="font-medium text-zinc-900">
                {plan.transaction_fee_pct}%
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Features List */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-zinc-900 mb-4">Plan Features</h3>
        
        <div className="space-y-3">
          {/* Your Plan features */}
          <div className="text-sm font-medium text-zinc-500 mb-2">Your Plan</div>
          {ALL_FEATURES.filter(f => hasFeature(f.key)).map(feature => (
            <div key={feature.key} className="flex items-center gap-3">
              <span className="text-emerald-600">✓</span>
              <div>
                <div className="font-medium text-zinc-900">{feature.label}</div>
                <div className="text-xs text-zinc-500">{feature.description}</div>
              </div>
            </div>
          ))}

          {/* Upgrade to unlock */}
          <div className="text-sm font-medium text-zinc-500 mb-2 mt-6">
            Upgrade to Unlock
          </div>
          {ALL_FEATURES.filter(f => !hasFeature(f.key)).map(feature => (
            <div key={feature.key} className="flex items-center gap-3 opacity-50">
              <span className="text-zinc-400">🔒</span>
              <div>
                <div className="font-medium text-zinc-900">{feature.label}</div>
                <div className="text-xs text-zinc-500">{feature.description}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Stripe Connection Status */}
      {isPaymentsPlan && (
        <section className="bg-white border border-zinc-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-zinc-900 mb-4">
            Stripe Connection
          </h3>
          
          {stripeEnabled ? (
            <div className="flex items-center gap-3">
              <span className="text-emerald-600 text-xl">✓</span>
              <div>
                <div className="font-medium text-zinc-900">Connected</div>
                <div className="text-sm text-zinc-500">
                  Your account is linked to Stripe for payments
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-zinc-400 text-xl">○</span>
                <div>
                  <div className="font-medium text-zinc-900">Not Connected</div>
                  <div className="text-sm text-zinc-500">
                    Connect Stripe to accept payments
                  </div>
                </div>
              </div>
              <a
                href="/settings/store"
                className="inline-flex items-center px-4 py-2 bg-zinc-900 text-white rounded-lg font-medium hover:bg-zinc-800 transition-colors"
              >
                Connect Stripe
              </a>
            </div>
          )}
        </section>
      )}

      {/* Upgrade CTA */}
      {!isPaymentsPlan && (
        <section className="bg-zinc-900 text-white rounded-lg p-6">
          <div className="flex items-start gap-4">
            <div className="text-3xl">🚀</div>
            <div>
              <h3 className="text-lg font-semibold mb-2">
                Upgrade to Payments Plan
              </h3>
              <p className="text-zinc-300 text-sm mb-4">
                Unlock Stripe payments, AI menu seeding, and more features for your restaurant.
              </p>
              <button className="px-4 py-2 bg-white text-zinc-900 rounded-lg font-medium hover:bg-zinc-100 transition-colors">
                Contact Support
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}