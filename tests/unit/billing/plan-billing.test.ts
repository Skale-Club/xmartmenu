import { describe, expect, it, vi } from 'vitest'

// plan-billing imports the Stripe client, which needs a secret key only when used.
vi.mock('@/lib/stripe', () => ({ stripe: {} }))

import { priceIdForCycle } from '@/lib/plan-billing'

describe('priceIdForCycle', () => {
  const plan = { stripe_price_monthly_id: 'price_m', stripe_price_annual_id: 'price_a' }

  it('picks the price of the billing cycle', () => {
    expect(priceIdForCycle(plan, 'monthly')).toBe('price_m')
    expect(priceIdForCycle(plan, 'annual')).toBe('price_a')
  })

  it('is null while the plan is not provisioned in Stripe', () => {
    expect(priceIdForCycle({ stripe_price_monthly_id: null, stripe_price_annual_id: null }, 'monthly')).toBeNull()
    expect(priceIdForCycle({ stripe_price_monthly_id: 'price_m', stripe_price_annual_id: '' }, 'annual')).toBeNull()
  })
})
