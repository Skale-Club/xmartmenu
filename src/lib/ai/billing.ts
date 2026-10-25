/**
 * Puts a client's billable AI usage on their Stripe bill.
 *
 * - Monthly, automatically: the plan's renewal invoice is created as a draft
 *   (Stripe webhook invoice.created) and we add one "AI usage" line to it
 *   before Stripe finalises it (about an hour later).
 * - On demand: Superadmin › client › AI › "Bill now" adds the line as a
 *   pending item, which Stripe puts on the next invoice.
 *
 * The line is real OpenRouter cost + margin (ai_usage_events.charge_usd),
 * converted with the panel's USD→BRL rate when the invoice is in BRL. The
 * events are then marked invoiced, so nothing is billed twice; the Stripe
 * idempotency key makes a retried webhook harmless too.
 */
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { log } from '@/lib/observability/log'
import { loadPlatformAiSettings } from './access'
import { invoiceAmountMinor } from './billing-rules'

export interface BillResult {
  billed: boolean
  reason?: 'no_stripe_customer' | 'nothing_to_bill' | 'below_minimum'
  events: number
  costUsd: number
  chargeUsd: number
  amountMinor: number
  currency: string
  invoiceItemId?: string
}

/** The plan subscription an invoice belongs to, across Stripe API shapes. */
export function subscriptionIdFromInvoice(invoice: {
  subscription?: string | null
  parent?: { subscription_details?: { subscription?: string | null } | null } | null
  lines?: { data?: Array<{ parent?: { subscription_item_details?: { subscription?: string | null } | null } | null }> }
}): string | null {
  if (typeof invoice.subscription === 'string') return invoice.subscription
  const fromParent = invoice.parent?.subscription_details?.subscription
  if (typeof fromParent === 'string') return fromParent
  const fromLine = invoice.lines?.data?.find(l => typeof l.parent?.subscription_item_details?.subscription === 'string')
  return fromLine?.parent?.subscription_item_details?.subscription ?? null
}

export function usageLineDescription(args: { events: number; costUsd: number; chargeUsd: number; amountMinor: number; currency: string; until: Date }): string {
  const day = args.until.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const money = (args.amountMinor / 100).toLocaleString('pt-BR', { style: 'currency', currency: args.currency.toUpperCase() })
  return `Inteligência artificial — ${args.events} chamadas até ${day} (custo US$ ${args.costUsd.toFixed(4)}, com margem US$ ${args.chargeUsd.toFixed(4)}): ${money}`
}

export async function billAiUsage(opts: { tenantId: string; invoiceId?: string; currency?: string; now?: Date }): Promise<BillResult> {
  const service = createServiceClient()
  const now = opts.now ?? new Date()
  const { data: subscription } = await service
    .from('tenant_subscriptions')
    .select('stripe_customer_id')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle()
  const currency = (opts.currency ?? 'brl').toLowerCase()
  const empty: BillResult = { billed: false, events: 0, costUsd: 0, chargeUsd: 0, amountMinor: 0, currency }
  if (!subscription?.stripe_customer_id) return { ...empty, reason: 'no_stripe_customer' }

  const { data: rows, error } = await service
    .from('ai_usage_events')
    .select('id, cost_usd, charge_usd')
    .eq('tenant_id', opts.tenantId)
    .eq('billable', true)
    .is('invoiced_at', null)
    .lte('occurred_at', now.toISOString())
    .order('id')
    .limit(50_000)
  if (error) throw error
  if (!rows?.length) return { ...empty, reason: 'nothing_to_bill' }

  const maxId = rows[rows.length - 1].id as number
  const costUsd = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0)
  const chargeUsd = rows.reduce((sum, r) => sum + Number(r.charge_usd), 0)
  const { usdToBrl } = await loadPlatformAiSettings()
  const amountMinor = invoiceAmountMinor(chargeUsd, currency, usdToBrl)
  // Under one cent: keep accumulating until it is worth a line.
  if (amountMinor < 1) return { ...empty, events: rows.length, costUsd, chargeUsd, reason: 'below_minimum' }

  const item = await stripe.invoiceItems.create(
    {
      customer: subscription.stripe_customer_id,
      ...(opts.invoiceId ? { invoice: opts.invoiceId } : {}),
      amount: amountMinor,
      currency,
      description: usageLineDescription({ events: rows.length, costUsd, chargeUsd, amountMinor, currency, until: now }),
      metadata: {
        kind: 'ai_usage',
        tenant_id: opts.tenantId,
        events: String(rows.length),
        cost_usd: costUsd.toFixed(8),
        charge_usd: chargeUsd.toFixed(8),
        usd_to_brl: String(usdToBrl),
        last_event_id: String(maxId),
      },
    },
    { idempotencyKey: `ai-usage-${opts.tenantId}-${maxId}` },
  )

  const { error: markError } = await service
    .from('ai_usage_events')
    .update({ invoiced_at: now.toISOString(), stripe_invoice_item_id: item.id })
    .eq('tenant_id', opts.tenantId)
    .eq('billable', true)
    .is('invoiced_at', null)
    .lte('id', maxId)
  if (markError) log.error('ai.billing_mark_failed', { err: markError, tenant_id: opts.tenantId, invoice_item: item.id })

  log.info('ai.billed', { tenant_id: opts.tenantId, events: rows.length, cost_usd: costUsd, charge_usd: chargeUsd, amount_minor: amountMinor, currency, invoice: opts.invoiceId ?? 'next' })
  return { billed: true, events: rows.length, costUsd, chargeUsd, amountMinor, currency, invoiceItemId: item.id }
}
