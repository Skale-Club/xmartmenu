/**
 * reconcile-payments.ts — REPORT ONLY. Compares orders with Stripe and lists
 * what disagrees; it never writes to the database or to Stripe (EX-04).
 *
 *   npm run payments:reconcile                 last 30 days
 *   npm run payments:reconcile -- --days=90
 *
 * Reports:
 *   - orders not marked paid whose PaymentIntent succeeded in Stripe
 *     (a lost or failed webhook: money taken, kitchen never told)
 *   - orders marked paid whose PaymentIntent is not succeeded
 *   - open rows in payment_divergences (paid after cancel, amount below
 *     total, currency/restaurant mismatch, second payment)
 *
 * Output carries order ids, statuses and amounts only: no names or phones.
 * Repairs are a separate, deliberate step per order.
 */

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const stripeKey = process.env.STRIPE_SECRET_KEY
if (!supabaseUrl || !serviceKey || !stripeKey) {
  console.error('Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STRIPE_SECRET_KEY')
  process.exit(1)
}

const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 30)
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
const stripe = new Stripe(stripeKey)

const PAID_LIKE = new Set(['paid', 'preparing', 'ready', 'out_for_delivery', 'done'])

async function main() {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, tenant_id, status, total, payment_intent_id, created_at')
    .not('payment_intent_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) throw error

  const unpaidButCharged: unknown[] = []
  const paidButNotCharged: unknown[] = []
  for (const order of orders ?? []) {
    const intent = await stripe.paymentIntents.retrieve(order.payment_intent_id as string)
    const paidLocally = PAID_LIKE.has(order.status)
    if (intent.status === 'succeeded' && !paidLocally) {
      unpaidButCharged.push({ order_id: order.id, tenant_id: order.tenant_id, status: order.status, total: order.total, charged_minor: intent.amount, currency: intent.currency })
    } else if (paidLocally && intent.status !== 'succeeded') {
      paidButNotCharged.push({ order_id: order.id, tenant_id: order.tenant_id, status: order.status, intent_status: intent.status })
    }
  }

  const { data: divergences, error: divError } = await supabase
    .from('payment_divergences')
    .select('id, order_id, tenant_id, payment_intent_id, kind, amount_minor, currency, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
  if (divError) throw divError

  console.log(JSON.stringify({
    window_days: days,
    orders_checked: orders?.length ?? 0,
    unpaid_but_charged: unpaidButCharged,
    paid_but_not_charged: paidButNotCharged,
    open_divergences: divergences ?? [],
  }, null, 2))
}

main().catch((err) => {
  console.error('reconcile-payments failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
