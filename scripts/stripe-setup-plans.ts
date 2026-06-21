/**
 * stripe-setup-plans.ts — create/ensure Stripe Products + recurring Prices for
 * each SaaS plan and write the IDs back into the `plans` table.
 *
 * Run once after migration 052, and again whenever a plan's price changes:
 *   npm run stripe:setup-plans
 *
 * Idempotent: Products are reused by stored id; Prices are keyed by lookup_key
 * (`<slug>_monthly` / `<slug>_annual`). When a price amount changes, a new Price
 * is created, the lookup_key is transferred to it, and the old one is archived
 * (Stripe Prices are immutable, so this is the canonical way to "edit" a price).
 */

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const stripeKey = process.env.STRIPE_SECRET_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(1)
}
if (!stripeKey) {
  console.error('Missing STRIPE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const stripe = new Stripe(stripeKey, { apiVersion: '2026-04-22.dahlia' })

const CURRENCY = 'brl'

interface PlanRow {
  id: string
  name: string
  slug: string
  description: string | null
  monthly_price: number
  annual_price: number
  stripe_product_id: string | null
}

async function ensurePrice(
  productId: string,
  lookupKey: string,
  dollars: number,
  interval: 'month' | 'year',
): Promise<string | null> {
  const amount = Math.round(Number(dollars) * 100)
  if (!Number.isFinite(amount) || amount <= 0) {
    console.warn(`  · skipping ${lookupKey} (non-positive amount)`)
    return null
  }

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  const found = existing.data[0]
  if (found && found.unit_amount === amount && found.currency === CURRENCY && found.recurring?.interval === interval) {
    console.log(`  · ${lookupKey} unchanged (${found.id})`)
    return found.id
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  })
  if (found) {
    await stripe.prices.update(found.id, { active: false })
    console.log(`  · ${lookupKey} re-priced → ${price.id} (archived ${found.id})`)
  } else {
    console.log(`  · ${lookupKey} created → ${price.id}`)
  }
  return price.id
}

async function main() {
  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, name, slug, description, monthly_price, annual_price, stripe_product_id')
    .order('sort_order')

  if (error) {
    console.error('Failed to load plans:', error.message)
    process.exit(1)
  }
  if (!plans?.length) {
    console.error('No plans found. Did migration 030 run?')
    process.exit(1)
  }

  for (const plan of plans as PlanRow[]) {
    console.log(`\nPlan: ${plan.name} (${plan.slug})`)

    // Product (reuse by stored id)
    let productId = plan.stripe_product_id
    if (productId) {
      await stripe.products.update(productId, {
        name: plan.name,
        description: plan.description ?? undefined,
      })
      console.log(`  · product reused (${productId})`)
    } else {
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description ?? undefined,
        metadata: { plan_id: plan.id, slug: plan.slug },
      })
      productId = product.id
      console.log(`  · product created (${productId})`)
    }

    const monthlyId = await ensurePrice(productId, `${plan.slug}_monthly`, plan.monthly_price, 'month')
    const annualId = await ensurePrice(productId, `${plan.slug}_annual`, plan.annual_price, 'year')

    const { error: updErr } = await supabase
      .from('plans')
      .update({
        stripe_product_id: productId,
        stripe_price_monthly_id: monthlyId,
        stripe_price_annual_id: annualId,
      })
      .eq('id', plan.id)
    if (updErr) {
      console.error(`  ! failed to persist ids for ${plan.slug}:`, updErr.message)
      process.exit(1)
    }
  }

  console.log('\n✅ Stripe plans synced.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
