import { describe, expect, it } from 'vitest'
import {
  computeOpenStatus,
  describeOrdering,
  describeProfile,
  parseDayHours,
  resolveOrderingMode,
  resolveTimeZone,
  type OpenStatus,
} from '@/lib/chat-context'

describe('resolveOrderingMode', () => {
  it('allows the cart only when the page shows it and checkout accepts it', () => {
    expect(resolveOrderingMode({ orders_enabled: true, direct_orders_enabled: true })).toBe('cart')
    // the case the old gate got wrong: orders on, but the page has no cart
    expect(resolveOrderingMode({ orders_enabled: true, direct_orders_enabled: false })).toBe('browse')
    // checkout rejects unless orders_enabled is explicitly true
    expect(resolveOrderingMode({ orders_enabled: null, direct_orders_enabled: true })).toBe('browse')
    expect(resolveOrderingMode({ orders_enabled: false, direct_orders_enabled: true })).toBe('browse')
  })

  it('treats a new restaurant (nothing configured) as browse-only', () => {
    expect(resolveOrderingMode({})).toBe('browse')
  })

  it('recognises WhatsApp ordering, which needs a number', () => {
    expect(resolveOrderingMode({ orders_enabled: true, whatsapp_orders_enabled: true, whatsapp: '5511999990000' })).toBe('whatsapp')
    expect(resolveOrderingMode({ whatsapp_orders_enabled: true, whatsapp: '5511999990000' })).toBe('whatsapp')
    expect(resolveOrderingMode({ orders_enabled: true, whatsapp_orders_enabled: true, whatsapp: null })).toBe('browse')
    expect(resolveOrderingMode({ orders_enabled: false, whatsapp_orders_enabled: true, whatsapp: '5511999990000' })).toBe('browse')
  })
})

describe('describeOrdering', () => {
  const cart = { orders_enabled: true, direct_orders_enabled: true, currency: 'USD' }

  it('says the cart is unavailable when browsing only, or points to WhatsApp', () => {
    expect(describeOrdering({}, { onlinePayment: false, deliveryZones: [] })).toContain('You CANNOT add items to a cart')
    const wa = describeOrdering({ whatsapp_orders_enabled: true, whatsapp: '5511999990000' }, { onlinePayment: false, deliveryZones: [] })
    expect(wa).toContain('through WhatsApp (5511999990000)')
    expect(wa).toContain('You CANNOT add items to a cart')
  })

  it('lists only the enabled order types, with pickup time and delivery fee', () => {
    const text = describeOrdering(
      { ...cart, dine_in_enabled: false, pickup_enabled: true, pickup_eta_minutes: 20, delivery_enabled: true, delivery_fee_cents: 499 },
      { onlinePayment: false, deliveryZones: [] },
    )
    expect(text).toContain('pickup, ready in about 20 minutes; delivery (fee $4.99)')
    expect(text).not.toContain('dine-in')
  })

  it('defaults dine-in on, like the menu page', () => {
    expect(describeOrdering(cart, { onlinePayment: false, deliveryZones: [] })).toContain('Order types available: dine-in (eat at the restaurant)')
  })

  it('uses delivery zone fees when the restaurant has zones', () => {
    const text = describeOrdering(
      { ...cart, delivery_enabled: true, delivery_fee_cents: 500 },
      { onlinePayment: false, deliveryZones: [{ name: 'Centro', fee_cents: 300 }, { name: 'Zona Sul', fee_cents: 800 }] },
    )
    expect(text).toContain('fee depends on the area: Centro $3.00, Zona Sul $8.00')
    expect(text).not.toContain('$5.00')
  })

  it('describes online (Stripe) vs in-person payment', () => {
    const online = describeOrdering(cart, { onlinePayment: true, deliveryZones: [] })
    expect(online).toContain('Payment is online, by card, at checkout')
    expect(online).toContain('and pay.')
    const inPerson = describeOrdering(cart, { onlinePayment: false, deliveryZones: [] })
    expect(inPerson).toContain('There is no online payment')
    expect(inPerson).not.toContain('and pay.')
  })

  it('mentions tips only when enabled', () => {
    expect(describeOrdering({ ...cart, tips_enabled: true }, { onlinePayment: true, deliveryZones: [] })).toContain('optional tip')
    expect(describeOrdering(cart, { onlinePayment: true, deliveryZones: [] })).not.toContain('tip')
  })
})

describe('resolveTimeZone', () => {
  it('uses the state for countries that span several zones', () => {
    expect(resolveTimeZone({ country: 'US', region: 'CA' })).toBe('America/Los_Angeles')
    expect(resolveTimeZone({ country: 'us', region: 'ma' })).toBe('America/New_York')
    expect(resolveTimeZone({ country: 'BR', region: 'AM' })).toBe('America/Manaus')
    expect(resolveTimeZone({ country: 'BR', region: 'SP' })).toBe('America/Sao_Paulo')
  })

  it('does not guess a US zone without the state', () => {
    expect(resolveTimeZone({ country: 'US', region: null })).toBeNull()
  })

  it('falls back to the country, then to the currency', () => {
    expect(resolveTimeZone({ country: 'PT' })).toBe('Europe/Lisbon')
    expect(resolveTimeZone({ country: null, currency: 'BRL' })).toBe('America/Sao_Paulo')
    expect(resolveTimeZone({ country: null, currency: 'USD' })).toBeNull()
  })
})

describe('parseDayHours', () => {
  it('reads the formats restaurants type', () => {
    expect(parseDayHours('11:00 - 23:00')).toEqual([[660, 1380]])
    expect(parseDayHours('11h às 15h, 18h às 23h')).toEqual([[660, 900], [1080, 1380]])
    expect(parseDayHours('11h30 - 22h')).toEqual([[690, 1320]])
    expect(parseDayHours('11am - 10pm')).toEqual([[660, 1320]])
    expect(parseDayHours('11:30 a.m. to 2:30 p.m.')).toEqual([[690, 870]])
    expect(parseDayHours('00:00 - 24:00')).toEqual([[0, 1440]])
  })

  it('runs ranges past midnight into the next day', () => {
    expect(parseDayHours('11:00 - 00:00')).toEqual([[660, 1440]])
    expect(parseDayHours('18:00 - 02:00')).toEqual([[1080, 1560]])
  })

  it('treats blank and "closed" as closed, and free text as unknown', () => {
    expect(parseDayHours('')).toEqual([])
    expect(parseDayHours(null)).toEqual([])
    expect(parseDayHours('Fechado')).toEqual([])
    expect(parseDayHours('Closed')).toEqual([])
    expect(parseDayHours('Pickup by confirmation')).toBeNull()
    expect(parseDayHours('25:00 - 26:00')).toBeNull()
  })
})

describe('computeOpenStatus', () => {
  // America/Sao_Paulo is UTC-3 all year. 2026-10-24 is a Saturday.
  const SP = 'America/Sao_Paulo'
  const at = (iso: string) => new Date(iso)
  const hours = {
    mon: '11:00 - 23:00', tue: '11:00 - 23:00', wed: '11:00 - 23:00', thu: '11:00 - 23:00',
    fri: '11:00 - 00:00', sat: '12:00 - 00:00', sun: '12:00 - 22:00',
  }

  it('is open inside today\'s hours and says when it closes', () => {
    expect(computeOpenStatus(hours, at('2026-10-24T17:05:00Z'), SP)).toEqual({
      status: 'open', localTime: 'Saturday 14:05', detail: 'Open now, closes at 00:00.',
    })
  })

  it('is closed before opening and says when it opens today', () => {
    expect(computeOpenStatus(hours, at('2026-10-24T13:00:00Z'), SP).detail).toBe('Closed now, opens today at 12:00.')
  })

  it('stays open after midnight for a range that started yesterday', () => {
    const late = { fri: '18:00 - 02:00' }
    // Saturday 01:00 local
    expect(computeOpenStatus(late, at('2026-10-24T04:00:00Z'), SP)).toMatchObject({ status: 'open', detail: 'Open now, closes at 02:00.' })
    // Saturday 03:00 local
    expect(computeOpenStatus(late, at('2026-10-24T06:00:00Z'), SP).status).toBe('closed')
  })

  it('finds the next opening day, skipping days without hours', () => {
    expect(computeOpenStatus({ sun: '12:00 - 22:00' }, at('2026-10-25T02:00:00Z'), SP).detail).toBe('Closed now, opens tomorrow at 12:00.')
    expect(computeOpenStatus({ mon: '11:00 - 23:00' }, at('2026-10-24T17:00:00Z'), SP).detail).toBe('Closed now, opens Monday at 11:00.')
  })

  it('passes free-text hours through instead of guessing', () => {
    // Friday noon in Boston
    const s = computeOpenStatus({ fri: 'Pickup by confirmation' }, at('2026-10-23T16:00:00Z'), 'America/New_York')
    expect(s.status).toBe('unknown')
    expect(s.detail).toContain('"Pickup by confirmation"')
  })

  it('is unknown without a time zone or without hours', () => {
    expect(computeOpenStatus(hours, at('2026-10-24T17:00:00Z'), null)).toMatchObject({ status: 'unknown', localTime: null })
    expect(computeOpenStatus(null, at('2026-10-24T17:00:00Z'), SP)).toMatchObject({ status: 'unknown', detail: 'No opening hours were provided.' })
  })
})

describe('describeProfile', () => {
  const open: OpenStatus = { status: 'open', localTime: 'Saturday 14:05', detail: 'Open now, closes at 00:00.' }

  it('includes the whole profile, the location and the other locations', () => {
    const text = describeProfile({
      name: 'Cantina',
      locationName: 'Pinheiros',
      tagline: 'Massas frescas',
      about: 'Desde 1998',
      cuisine: 'Italiana',
      priceRange: '$$',
      address: 'Rua A, 10',
      city: 'São Paulo',
      region: 'SP',
      country: 'BR',
      phone: '+55 11 3333-0000',
      whatsapp: '5511999990000',
      instagram: 'cantina',
      hours: { mon: '11:00 - 23:00', sat: '12:00 - 00:00' },
      otherLocations: [{ name: 'Moema', address: 'Av. B, 20', city: 'São Paulo' }],
    }, open)
    expect(text).toContain('- Name: Cantina — Pinheiros location')
    expect(text).toContain('- Tagline: Massas frescas')
    expect(text).toContain('- About: Desde 1998')
    expect(text).toContain('- Cuisine: Italiana')
    expect(text).toContain('- Price range: $$')
    expect(text).toContain('- Address: Rua A, 10, São Paulo, SP, BR')
    expect(text).toContain('- WhatsApp: 5511999990000')
    expect(text).toContain('- Instagram: @cantina')
    expect(text).toContain('- Other locations: Moema, Av. B, 20, São Paulo')
    expect(text).toContain('- Monday: 11:00 - 23:00')
    expect(text).toContain('- Tuesday: closed')
    expect(text).toContain('- Right now (Saturday 14:05 local time): Open now, closes at 00:00.')
  })

  it('tells the assistant to warn about ordering while closed', () => {
    const text = describeProfile({ name: 'Cantina', hours: { mon: '11:00 - 23:00' } }, { status: 'closed', localTime: 'Saturday 14:05', detail: 'Closed now, opens Monday at 11:00.' })
    expect(text).toContain('Closed now, opens Monday at 11:00.')
    expect(text).toContain('mention it whenever the customer wants to order')
  })

  it('says when hours or contact are missing', () => {
    const text = describeProfile({ name: 'Cantina' }, { status: 'unknown', localTime: null, detail: 'No opening hours were provided.' })
    expect(text).toContain('- Address: not provided')
    expect(text).toContain('- Phone: not provided')
    expect(text).toContain('Not provided. If asked, tell the customer to check with the restaurant.')
  })
})
