import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/stripe', () => ({
  getTenantCurrency: vi.fn(async () => 'brl'),
  toStripeAmount: (major: number) => Math.round(major * 100),
}))
const analytics = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/analytics/server', () => ({ recordTrustedOrderAnalyticsEvent: (...a: unknown[]) => analytics(...a) }))
vi.mock('@/lib/observability', () => ({ captureSecurityEvent: vi.fn() }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { applyPaymentSignal, type IntentFacts } from '@/lib/orders/payment-sync'

type Row = Record<string, unknown>

/** Minimal in-memory stand-in for the two tables payment-sync touches. */
function fakeDb(initial: Row, opts: { failUpdate?: boolean } = {}) {
  const orders = new Map<string, Row>([[initial.id as string, { ...initial }]])
  const divergences: Row[] = []
  const client = {
    from(table: string) {
      if (table === 'payment_divergences') {
        return { upsert: async (row: Row) => { divergences.push(row); return { error: null } } }
      }
      const filters: Array<[string, unknown]> = []
      let patch: Row | null = null
      const builder = {
        select() { return builder },
        update(p: Row) { patch = p; return builder },
        eq(col: string, val: unknown) { filters.push([col, val]); return builder },
        async maybeSingle() {
          const row = [...orders.values()].find((r) => filters.every(([c, v]) => r[c] === v))
          return { data: row ? { ...row } : null, error: null }
        },
        then(resolve: (v: unknown) => void) {
          if (opts.failUpdate) return resolve({ data: null, error: { message: 'db down' } })
          const matched = [...orders.values()].filter((r) => filters.every(([c, v]) => r[c] === v))
          for (const r of matched) Object.assign(r, patch)
          resolve({ data: matched.map((r) => ({ id: r.id, status: r.status })), error: null })
        },
      }
      return builder
    },
  }
  return { client: client as never, orders, divergences }
}

const ORDER = { id: 'o1', tenant_id: 't1', status: 'awaiting_payment', total: 50, payment_intent_id: 'pi_current', currency: 'brl' }
const intent = (over: Partial<IntentFacts> = {}): IntentFacts => ({
  id: 'pi_current', amount: 5000, currency: 'brl', metadata: { order_id: 'o1', tenant_id: 't1' }, ...over,
})

beforeEach(() => analytics.mockClear())

describe('applyPaymentSignal', () => {
  it('failure then success of the current intent: paid once', async () => {
    const db = fakeDb(ORDER)
    await applyPaymentSignal(db.client, intent(), 'failed')
    expect(db.orders.get('o1')!.status).toBe('payment_failed')
    const r = await applyPaymentSignal(db.client, intent(), 'succeeded')
    expect(r).toMatchObject({ ok: true, changed: true, status: 'paid' })
    expect(analytics).toHaveBeenCalledTimes(1)
  })

  it('success then a late failure: stays paid', async () => {
    const db = fakeDb(ORDER)
    await applyPaymentSignal(db.client, intent(), 'succeeded')
    const r = await applyPaymentSignal(db.client, intent(), 'failed')
    expect(r.changed).toBe(false)
    expect(db.orders.get('o1')!.status).toBe('paid')
  })

  it('cancelling the losing intent leaves the order alone', async () => {
    const db = fakeDb(ORDER)
    const r = await applyPaymentSignal(db.client, intent({ id: 'pi_loser' }), 'canceled')
    expect(r.changed).toBe(false)
    expect(db.orders.get('o1')).toMatchObject({ status: 'awaiting_payment', payment_intent_id: 'pi_current' })
  })

  it('the same event twice: one transition, one analytics event', async () => {
    const db = fakeDb(ORDER)
    const [a, b] = await Promise.all([
      applyPaymentSignal(db.client, intent(), 'succeeded'),
      applyPaymentSignal(db.client, intent(), 'succeeded'),
    ])
    expect([a.changed, b.changed].filter(Boolean)).toHaveLength(1)
    expect(analytics).toHaveBeenCalledTimes(1)
  })

  it('a database failure is reported so Stripe retries', async () => {
    const db = fakeDb(ORDER, { failUpdate: true })
    const r = await applyPaymentSignal(db.client, intent(), 'succeeded')
    expect(r.ok).toBe(false)
  })

  it('payment for a cancelled order is recorded as a divergence, not applied', async () => {
    const db = fakeDb({ ...ORDER, status: 'cancelled' })
    const r = await applyPaymentSignal(db.client, intent(), 'succeeded')
    expect(r.changed).toBe(false)
    expect(db.orders.get('o1')!.status).toBe('cancelled')
    expect(db.divergences.map((d) => d.kind)).toEqual(['paid_after_cancel'])
  })

  it('a late payment event never moves an order the kitchen advanced', async () => {
    const db = fakeDb({ ...ORDER, status: 'preparing' })
    await applyPaymentSignal(db.client, intent(), 'succeeded')
    await applyPaymentSignal(db.client, intent(), 'failed')
    expect(db.orders.get('o1')!.status).toBe('preparing')
  })

  it('a short, foreign-currency or foreign-restaurant payment is not applied', async () => {
    for (const [over, kind] of [
      [{ amount: 100 }, 'amount_below_total'],
      [{ currency: 'usd' }, 'currency_mismatch'],
      [{ metadata: { order_id: 'o1', tenant_id: 't2' } }, 'tenant_mismatch'],
    ] as const) {
      const db = fakeDb(ORDER)
      const r = await applyPaymentSignal(db.client, intent(over as Partial<IntentFacts>), 'succeeded')
      expect(r.changed).toBe(false)
      expect(db.orders.get('o1')!.status).toBe('awaiting_payment')
      expect(db.divergences[0]?.kind).toBe(kind)
    }
  })

  it('a second intent paid for an already paid order is a divergence', async () => {
    const db = fakeDb({ ...ORDER, status: 'paid' })
    await applyPaymentSignal(db.client, intent({ id: 'pi_other' }), 'succeeded')
    expect(db.divergences[0]?.kind).toBe('second_payment')
  })
})
