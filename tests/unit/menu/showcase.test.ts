import { describe, expect, it } from 'vitest'
import {
  contactLinks,
  displayPrice,
  formatOptionPrice,
  instagramProfile,
  optionPriceList,
  orderedItemText,
  priceListText,
  showcaseItemText,
  telUrl,
  whatsappDigits,
  whatsappUrl,
  type PricedOptionGroup,
} from '@/components/menu/showcase'
import { embeddedCurrency } from '@/components/menu/menu-utils'

const money = (v: number) => `$${v.toFixed(2)}`

// Celes Confections: every cake has a required "Size" group.
const sizes: PricedOptionGroup = {
  id: 'g1', name: 'Size', type: 'single',
  options: [
    { id: 'o1', name: 'Slice', base_price: 15, price_modifier: 0 },
    { id: 'o2', name: '5-inch', base_price: 60, price_modifier: 0 },
    { id: 'o3', name: '10-inch', base_price: 180, price_modifier: 0 },
  ],
}
const toppings: PricedOptionGroup = {
  id: 'g2', name: 'Toppings', type: 'multiple',
  options: [
    { id: 't1', name: 'Berries', base_price: null, price_modifier: 2 },
    { id: 't2', name: 'No sugar', base_price: null, price_modifier: -1 },
    { id: 't3', name: 'Sprinkles', base_price: null, price_modifier: 0 },
  ],
}

describe('option price list (showcase)', () => {
  it('shows a size at its price and a modifier as + / −', () => {
    expect(formatOptionPrice(sizes.options[0], money)).toBe('$15.00')
    expect(formatOptionPrice(toppings.options[0], money)).toBe('+ $2.00')
    expect(formatOptionPrice(toppings.options[1], money)).toBe('− $1.00')
    expect(formatOptionPrice(toppings.options[2], money)).toBeNull()
  })

  it('lists every option of a group as read-only rows', () => {
    expect(optionPriceList(sizes, money)).toEqual([
      { id: 'o1', name: 'Slice', price: '$15.00' },
      { id: 'o2', name: '5-inch', price: '$60.00' },
      { id: 'o3', name: '10-inch', price: '$180.00' },
    ])
    expect(priceListText(sizes, money)).toBe('Slice $15.00 · 5-inch $60.00 · 10-inch $180.00')
    expect(priceListText(toppings, money)).toBe('Berries + $2.00 · No sugar − $1.00 · Sprinkles')
  })
})

describe('displayPrice ("From $15.00")', () => {
  it('uses the lowest size price when a group sets the price', () => {
    expect(displayPrice(0, [sizes])).toEqual({ amount: 15, from: true })
    expect(displayPrice(99, [toppings, sizes])).toEqual({ amount: 15, from: true })
  })

  it('is the dish price without sizes', () => {
    expect(displayPrice(12, [])).toEqual({ amount: 12, from: false })
    expect(displayPrice(12, null)).toEqual({ amount: 12, from: false })
    expect(displayPrice(12, [toppings])).toEqual({ amount: 12, from: false })
  })

  it('options without a base price in a size group count as the dish price plus their modifier', () => {
    const mixed: PricedOptionGroup = { id: 'g', name: 'Size', type: 'single', options: [
      { id: 'a', name: 'Small', base_price: null, price_modifier: 0 },
      { id: 'b', name: 'Large', base_price: 20, price_modifier: 0 },
    ] }
    expect(displayPrice(10, [mixed])).toEqual({ amount: 10, from: true })
  })

  it('does not say "From" when every size costs the same', () => {
    const same: PricedOptionGroup = { id: 'g', name: 'Size', type: 'single', options: [
      { id: 'a', name: 'A', base_price: 9, price_modifier: 0 },
      { id: 'b', name: 'B', base_price: 9, price_modifier: 0 },
    ] }
    expect(displayPrice(0, [same])).toEqual({ amount: 9, from: false })
  })
})

describe('WhatsApp item text', () => {
  it('names the dish with its sizes when nothing was chosen', () => {
    expect(showcaseItemText('Carrot cake', 0, [sizes], money)).toBe('Carrot cake (Slice $15.00 · 5-inch $60.00 · 10-inch $180.00)')
    expect(showcaseItemText('Coffee', 4, [], money)).toBe('Coffee · $4.00')
  })

  it('includes the choices made', () => {
    expect(orderedItemText('Carrot cake', { Size: '5-inch' }, 60, money)).toBe('Carrot cake (Size: 5-inch) · $60.00')
    expect(orderedItemText('Coffee', {}, 4, money)).toBe('Coffee · $4.00')
    expect(orderedItemText('Coffee', { Milk: '' }, 4, money)).toBe('Coffee · $4.00')
  })
})

describe('contact links', () => {
  it('normalizes a WhatsApp number to digits', () => {
    expect(whatsappDigits('+1 (555) 123-4567')).toBe('15551234567')
    expect(whatsappDigits('(12)')).toBeNull()
    expect(whatsappDigits(null)).toBeNull()
    expect(whatsappUrl('+1 (555) 123-4567')).toBe('https://wa.me/15551234567')
    expect(whatsappUrl('+1 (555) 123-4567', 'Hi! Cake & tea')).toBe('https://wa.me/15551234567?text=Hi!%20Cake%20%26%20tea')
    expect(whatsappUrl('')).toBeNull()
  })

  it('builds tel: links keeping the leading +', () => {
    expect(telUrl('+1 (555) 123-4567')).toBe('tel:+15551234567')
    expect(telUrl('555 1234')).toBe('tel:5551234')
    expect(telUrl('  ')).toBeNull()
  })

  it('accepts Instagram as handle, @handle or full URL', () => {
    expect(instagramProfile('celes')).toEqual({ url: 'https://instagram.com/celes', handle: '@celes' })
    expect(instagramProfile('@celes')).toEqual({ url: 'https://instagram.com/celes', handle: '@celes' })
    expect(instagramProfile('https://www.instagram.com/celes/')).toEqual({ url: 'https://www.instagram.com/celes/', handle: '@celes' })
    expect(instagramProfile('')).toBeNull()
    expect(instagramProfile(null)).toBeNull()
  })

  it('returns only the links that are present', () => {
    expect(contactLinks({ whatsapp: '(555) 123-4567', phone: null, instagram: '@celes' }, 'Hi')).toEqual({
      whatsapp: 'https://wa.me/5551234567?text=Hi',
      phone: null,
      instagram: { url: 'https://instagram.com/celes', handle: '@celes' },
    })
    expect(contactLinks(null)).toEqual({ whatsapp: null, phone: null, instagram: null })
    expect(contactLinks({ phone: ' +1 555 0100 ' }).phone).toEqual({ url: 'tel:+15550100', label: '+1 555 0100' })
  })
})

describe('embeddedCurrency (checkout pages)', () => {
  it('reads tenant_settings.currency embedded as an object or an array', () => {
    expect(embeddedCurrency({ tenant_settings: { currency: 'usd' } })).toBe('USD')
    expect(embeddedCurrency({ tenant_settings: [{ currency: 'BRL' }] })).toBe('BRL')
    expect(embeddedCurrency({ tenant_settings: null })).toBe('USD')
    expect(embeddedCurrency(null, 'EUR')).toBe('EUR')
    expect(embeddedCurrency({ tenant_settings: { currency: 'R$' } })).toBe('USD')
  })
})
