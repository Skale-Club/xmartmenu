import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = { events: [] as Row[], failNextMark: false }
const created: Array<{ key: string; amount: number }> = []

vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/ai/access', () => ({ loadPlatformAiSettings: async () => ({ usdToBrl: 5 }) }))
vi.mock('@/lib/stripe', () => ({
  stripe: {
    invoiceItems: {
      // Stripe idempotency: the same key returns the same item, no new charge.
      create: async (params: { amount: number }, opts: { idempotencyKey: string }) => {
        const existing = created.find((c) => c.key === opts.idempotencyKey)
        if (!existing) created.push({ key: opts.idempotencyKey, amount: params.amount })
        return { id: `ii_${opts.idempotencyKey}` }
      },
    },
  },
}))

/** Just enough of the query builder for billAiUsage. */
function table(name: string) {
  const filters: Array<(r: Row) => boolean> = []
  let patch: Row | null = null
  let wantRows = false
  const rows = () => (name === 'tenant_subscriptions' ? [{ tenant_id: 't1', stripe_customer_id: 'cus_1' }] : db.events)
  const run = () => {
    const matched = rows().filter((r) => filters.every((f) => f(r)))
    if (patch) {
      if (db.failNextMark && 'invoiced_at' in patch) {
        db.failNextMark = false
        return { data: null, error: { message: 'db down' } }
      }
      for (const r of matched) Object.assign(r, patch)
    }
    return { data: wantRows || !patch ? matched.map((r) => ({ ...r })) : null, error: null }
  }
  const b = {
    select() { wantRows = true; return b },
    update(p: Row) { patch = p; return b },
    eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b },
    is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return b },
    not(c: string, _op: string, v: unknown) { filters.push((r) => (r[c] ?? null) !== v); return b },
    lte(c: string, v: string) { filters.push((r) => String(r[c]) <= v); return b },
    order() { return b },
    limit() { return b },
    async maybeSingle() { const r = run(); return { data: (r.data ?? [])[0] ?? null, error: r.error } },
    then(resolve: (v: unknown) => void) { resolve(run()) },
  }
  return b
}
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: (n: string) => table(n) }) }))

import { billAiUsage } from '@/lib/ai/billing'

const event = (id: number) => ({ id, tenant_id: 't1', billable: true, invoiced_at: null, billing_batch: null, occurred_at: '2026-10-01T00:00:00.000Z', cost_usd: 0.5, charge_usd: 1 })

beforeEach(() => {
  db.events = [event(1), event(2)]
  db.failNextMark = false
  created.length = 0
})

describe('billAiUsage', () => {
  it('a failed mark is finished by the next run with the same key: one charge', async () => {
    db.failNextMark = true
    await billAiUsage({ tenantId: 't1', now: new Date('2026-10-02T00:00:00Z') })
    expect(created).toHaveLength(1)
    // New calls arrive before the next run.
    db.events.push(event(3))
    await billAiUsage({ tenantId: 't1', now: new Date('2026-10-03T00:00:00Z') })
    expect(created).toHaveLength(1) // the pending batch was re-sent under its key, not charged again
    expect(db.events.filter((e) => e.invoiced_at).map((e) => e.id)).toEqual([1, 2])
    // The new call is billed on the following run, on its own.
    await billAiUsage({ tenantId: 't1', now: new Date('2026-10-04T00:00:00Z') })
    expect(created).toHaveLength(2)
    expect(db.events.every((e) => e.invoiced_at)).toBe(true)
  })

  it('only the claimed events are marked invoiced', async () => {
    await billAiUsage({ tenantId: 't1', now: new Date('2026-10-02T00:00:00Z') })
    db.events.push(event(3))
    expect(db.events.find((e) => e.id === 3)?.invoiced_at).toBeNull()
  })

  it('running twice in a row bills once', async () => {
    await billAiUsage({ tenantId: 't1', now: new Date('2026-10-02T00:00:00Z') })
    await billAiUsage({ tenantId: 't1', now: new Date('2026-10-02T00:00:00Z') })
    expect(created).toHaveLength(1)
  })
})
