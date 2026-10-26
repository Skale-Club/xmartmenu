import { describe, expect, it } from 'vitest'
import { activeCalls, canCallWaiter, parseCallReason, parseCallStatus, upsertCall, waitingFor, CALL_STALE_MS } from '@/lib/waiter-calls'
import { getGuestCopy, GUEST_COPY_LANGUAGES } from '@/components/menu/guest-copy'
import { MENU_LANGUAGE_CODES } from '@/components/menu/menu-i18n'
import { buildSystemPrompt, describeCart, parseCartSnapshot } from '@/lib/chat-agent'
import { normalizeOrderAttribution, revenueShare } from '@/lib/analytics/upsell'
import { formatDuration, normalizeEngagement, normalizePlatformOverview, peakHour, share } from '@/lib/analytics/engagement'
import { fitWithin } from '@/lib/media/client-compress'
import { posterArgs, videoTranscodeArgs } from '@/lib/media/video'
import { planBadgeClass } from '@/lib/plan-badge'
import { restoreCart, serializeCart } from '@/components/menu/menu-session'
import type { Product } from '@/types/database'

describe('waiter calls', () => {
  it('available when the restaurant serves at the table', () => {
    expect(canCallWaiter({ waiterOrdering: true, guestOrdering: false })).toBe(true)
    expect(canCallWaiter({ waiterOrdering: false, guestOrdering: true })).toBe(true)
    expect(canCallWaiter({ waiterOrdering: false, guestOrdering: false })).toBe(false)
  })

  it('parses reason and status defensively', () => {
    expect(parseCallReason('bill')).toBe('bill')
    expect(parseCallReason('anything')).toBe('waiter')
    expect(parseCallStatus('done')).toBe('done')
    expect(parseCallStatus('open')).toBeNull()
  })

  it('lists open calls oldest first and drops done or stale ones', () => {
    const now = Date.parse('2026-10-25T20:00:00Z')
    const at = (min: number) => new Date(now - min * 60_000).toISOString()
    const calls = [
      { id: 'a', status: 'open' as const, created_at: at(2) },
      { id: 'b', status: 'acknowledged' as const, created_at: at(10) },
      { id: 'c', status: 'done' as const, created_at: at(1) },
      { id: 'd', status: 'open' as const, created_at: new Date(now - CALL_STALE_MS - 1).toISOString() },
    ]
    expect(activeCalls(calls, now).map(c => c.id)).toEqual(['b', 'a'])
    expect(waitingFor(at(3), now)).toBe('3 min ago')
    expect(waitingFor(at(0), now)).toBe('just now')
  })

  it('upserts realtime rows by id', () => {
    const list = [{ id: 'a', status: 'open' }]
    expect(upsertCall(list, { id: 'a', status: 'done' })).toEqual([{ id: 'a', status: 'done' }])
    expect(upsertCall(list, { id: 'b', status: 'open' })).toHaveLength(2)
  })
})

describe('guest copy (chat box, call buttons)', () => {
  it('covers every menu language with every key and placeholder', () => {
    const en = getGuestCopy('en')
    for (const code of MENU_LANGUAGE_CODES) {
      expect(GUEST_COPY_LANGUAGES, code).toContain(code)
      const copy = getGuestCopy(code)
      for (const [key, text] of Object.entries(en)) {
        const value = copy[key as keyof typeof copy]
        expect(value, `${code}.${key}`).toBeTruthy()
        for (const placeholder of text.match(/\{\w+\}/g) ?? []) expect(value, `${code}.${key}`).toContain(placeholder)
      }
    }
  })

  it('falls back to the base language, then English', () => {
    expect(getGuestCopy('pt-BR').callWaiter).toBe('Chamar garçom')
    expect(getGuestCopy('xx').callWaiter).toBe('Call waiter')
  })
})

describe('chat sees the cart', () => {
  it('keeps a bounded, text-only cart', () => {
    expect(parseCartSnapshot('nope')).toEqual([])
    expect(parseCartSnapshot([
      { name: ' Burger\n', quantity: 2, options: 'Size: Large' },
      { name: '', quantity: 1 },
      { name: 'Cola', quantity: 0 },
      { name: 'Fries', quantity: 1000 },
      { name: 'Juice', quantity: 1.7 },
    ])).toEqual([{ name: 'Burger', quantity: 2, options: 'Size: Large' }, { name: 'Juice', quantity: 1 }])
    expect(parseCartSnapshot(Array.from({ length: 50 }, (_, i) => ({ name: `D${i}`, quantity: 1 })))).toHaveLength(30)
  })

  it('puts the cart and the guest language in the prompt', () => {
    const base = { name: 'Bistro', profile: 'p', menuContext: 'm', ordering: 'o' }
    const prompt = buildSystemPrompt({ ...base, canAddToCart: true, cart: [{ name: 'Burger', quantity: 2 }], guestLanguage: 'Portuguese' })
    expect(prompt).toContain("CUSTOMER'S CART RIGHT NOW")
    expect(prompt).toContain('- 2× Burger')
    expect(prompt).toContain('use Portuguese')
    expect(buildSystemPrompt({ ...base, canAddToCart: false, cart: [{ name: 'Burger', quantity: 1 }] })).not.toContain('CART RIGHT NOW')
    expect(describeCart([])).toBe('The cart is empty.')
  })
})

describe('attribution and screen time', () => {
  it('normalizes sales by source', () => {
    const a = normalizeOrderAttribution({ orders: '10', items_revenue: '200', upsell: { orders: 4, items: 6, revenue: '50' }, chat: null })
    expect(a).toEqual({ orders: 10, items_revenue: 200, upsell: { orders: 4, items: 6, revenue: 50 }, chat: { orders: 0, items: 0, revenue: 0 } })
    expect(revenueShare(a.upsell, a)).toBe(0.25)
    expect(revenueShare(a.upsell, normalizeOrderAttribution(null))).toBe(0)
  })

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(135)).toBe('2m 15s')
    expect(formatDuration(120)).toBe('2m')
    expect(formatDuration(3900)).toBe('1h 5m')
  })

  it('reads engagement and finds the busiest hour', () => {
    const e = normalizeEngagement({ sessions: 10, median_seconds: '95.5', by_hour: [{ key: 12, sessions: 3 }, { key: 20, sessions: 7 }], devices: [{ key: 'mobile', sessions: 8 }] })
    expect(e.median_seconds).toBe(95.5)
    expect(peakHour(e)).toEqual({ hour: 20, sessions: 7 })
    expect(share(e.devices[0], e.sessions)).toBe(0.8)
    expect(peakHour(normalizeEngagement(null))).toBeNull()
  })

  it('reads the platform overview', () => {
    expect(normalizePlatformOverview([{ tenant_id: 't', name: 'A', sessions: 3, revenue: '9.5' }, { name: 'no id' }])).toEqual([
      { tenant_id: 't', name: 'A', slug: '', plan: null, currency: 'USD', sessions: 3, median_seconds: 0, orders: 0, revenue: 9.5, waiter_calls: 0 },
    ])
  })
})

describe('media', () => {
  it('fits photos inside the longest side without enlarging', () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 })
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 })
  })

  it('encodes videos as small, muted, fast-start MP4s', () => {
    const args = videoTranscodeArgs('in', 'out.mp4')
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-an', '-movflags', '+faststart', '-t', '60']))
    expect(args[args.indexOf('-vf') + 1]).toContain('min(720,ih)')
    expect(args.at(-1)).toBe('out.mp4')
    expect(posterArgs('v.mp4', 'p.jpg')).toEqual(expect.arrayContaining(['-frames:v', '1', 'p.jpg']))
  })
})

describe('plan badge', () => {
  it('colours the current plans and falls back for unknown ones', () => {
    expect(planBadgeClass('payments')).toContain('purple')
    expect(planBadgeClass('orders')).toContain('blue')
    expect(planBadgeClass('free')).toBe('bg-zinc-100 text-zinc-500')
    expect(planBadgeClass(null)).toBe('bg-zinc-100 text-zinc-500')
  })
})

describe('cart keeps where an item came from', () => {
  it('survives a reload', () => {
    const product = { id: 'p1', price: 5, name: 'Cola' } as Product
    const stored = serializeCart([{ product, quantity: 1, selectedOptions: {}, unitPrice: 5, cartKey: 'k', addedVia: 'upsell' }])
    expect(stored[0].addedVia).toBe('upsell')
    expect(restoreCart(stored, [product])[0].addedVia).toBe('upsell')
    expect(restoreCart([{ ...stored[0], addedVia: 'hack' as never }], [product])[0].addedVia).toBeUndefined()
  })
})
