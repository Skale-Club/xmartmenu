import { describe, expect, it } from 'vitest'
import type { Product } from '@/types/database'
import { buildCartKey, type CartItem } from '@/components/menu/menu-utils'
import {
  CART_TTL_MS,
  EMPTY_SCREEN_STATE,
  cartStorageKey,
  isDraftEmpty,
  normalizeScreenState,
  readStored,
  removeStored,
  resolveInitialView,
  restoreCart,
  serializeCart,
  sessionStorageKey,
  urlWithView,
  writeStored,
  type StorageLike,
} from '@/components/menu/menu-session'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: (k) => { data.delete(k) },
  }
}

const product = (id: string, price: number) => ({ id, name: id, price } as unknown as Product)
const BURGER = product('burger', 30)
const SODA = product('soda', 6)

describe('resolveInitialView', () => {
  it('lets the URL win, in both directions', () => {
    expect(resolveInitialView({ urlView: 'feed', defaultView: 'list', feedEnabled: true })).toBe('feed')
    // switched to the list on a feed link, then reloaded
    expect(resolveInitialView({ urlView: 'list', defaultView: 'feed', feedEnabled: true })).toBe('list')
  })

  it("falls back to the restaurant's default", () => {
    expect(resolveInitialView({ urlView: null, defaultView: 'feed', feedEnabled: true })).toBe('feed')
    expect(resolveInitialView({ urlView: undefined, defaultView: 'list', feedEnabled: true })).toBe('list')
    expect(resolveInitialView({ urlView: 'garbage', defaultView: null, feedEnabled: true })).toBe('list')
  })

  it('never opens the feed when it is disabled', () => {
    expect(resolveInitialView({ urlView: 'feed', defaultView: 'feed', feedEnabled: false })).toBe('list')
  })
})

describe('urlWithView', () => {
  it('sets ?view= and keeps the other parameters', () => {
    expect(urlWithView('https://x.club/aurora?lang=pt&table=4', 'list')).toBe('https://x.club/aurora?lang=pt&table=4&view=list')
    expect(urlWithView('https://x.club/feed/aurora?view=feed', 'list')).toBe('https://x.club/feed/aurora?view=list')
  })
})

describe('readStored / writeStored', () => {
  it('round-trips data', () => {
    const s = memoryStorage()
    writeStored(s, 'k', { a: 1 }, 1000)
    expect(readStored(s, 'k', 2000)).toEqual({ a: 1 })
  })

  it('expires after the TTL and cleans up', () => {
    const s = memoryStorage()
    writeStored(s, 'k', [1], 0)
    expect(readStored(s, 'k', CART_TTL_MS, CART_TTL_MS)).toEqual([1])
    expect(readStored(s, 'k', CART_TTL_MS + 1, CART_TTL_MS)).toBeNull()
    expect(s.data.has('k')).toBe(false)
  })

  it('survives corrupt values and unavailable or broken storage', () => {
    const s = memoryStorage()
    s.setItem('k', '{not json')
    expect(readStored(s, 'k', 0)).toBeNull()
    s.setItem('k', JSON.stringify({ nope: true }))
    expect(readStored(s, 'k', 0)).toBeNull()
    expect(readStored(null, 'k', 0)).toBeNull()
    const broken: StorageLike = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => { throw new Error('SecurityError') },
    }
    expect(readStored(broken, 'k', 0)).toBeNull()
    expect(() => writeStored(broken, 'k', 1, 0)).not.toThrow()
    expect(() => removeStored(broken, 'k')).not.toThrow()
  })

  it('keys carts and screen state per tenant and menu', () => {
    expect(cartStorageKey('t1', 'm1')).not.toBe(cartStorageKey('t1', 'm2'))
    expect(cartStorageKey('t1', null)).toBe('xm:cart:v1:t1:default')
    expect(sessionStorageKey('t1', 'm1')).not.toBe(cartStorageKey('t1', 'm1'))
  })
})

describe('serializeCart / restoreCart', () => {
  const plain: CartItem = { product: BURGER, quantity: 2, selectedOptions: {}, unitPrice: 30, cartKey: buildCartKey('burger', {}) }
  const custom: CartItem = {
    product: BURGER, quantity: 1, selectedOptions: { Size: 'Large' }, unitPrice: 38, cartKey: buildCartKey('burger', { Size: 'Large' }),
    note: 'no salt', editorState: { singleSelections: { g: 'o' }, halfSelections: {}, multiSelections: {}, ingredientSteppers: {}, addedIngredients: [], note: 'no salt' },
  }

  it('round-trips a cart through storage', () => {
    const restored = restoreCart(JSON.parse(JSON.stringify(serializeCart([plain, custom]))), [BURGER, SODA])
    expect(restored.map((i) => [i.cartKey, i.quantity, i.unitPrice, i.note])).toEqual([
      [plain.cartKey, 2, 30, undefined],
      [custom.cartKey, 1, 38, 'no salt'],
    ])
    expect(restored[1].editorState?.singleSelections).toEqual({ g: 'o' })
  })

  it('drops dishes that are no longer on the menu', () => {
    expect(restoreCart(serializeCart([plain]), [SODA])).toEqual([])
  })

  it('reprices plain items to the current price, keeps customized ones', () => {
    const repriced = product('burger', 32)
    const restored = restoreCart(serializeCart([plain, custom]), [repriced])
    expect(restored.map((i) => i.unitPrice)).toEqual([32, 38])
    expect(restored[0].product).toBe(repriced)
  })

  it('ignores junk entries, bad quantities and duplicates', () => {
    const junk = [
      null,
      { productId: 'burger', quantity: 0, selectedOptions: {}, unitPrice: 30 },
      { productId: 'burger', quantity: 'x', selectedOptions: {}, unitPrice: 30 },
      { productId: 'soda', quantity: 1000, selectedOptions: {}, unitPrice: 6 },
      { productId: 'soda', quantity: 1, selectedOptions: {}, unitPrice: 6 },
    ]
    const restored = restoreCart(junk as never, [BURGER, SODA])
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ cartKey: buildCartKey('soda', {}), quantity: 99 })
    expect(restoreCart(undefined, [BURGER])).toEqual([])
    expect(restoreCart({} as never, [BURGER])).toEqual([])
  })
})

describe('normalizeScreenState', () => {
  it('returns the empty state for anything unusable', () => {
    expect(normalizeScreenState(null)).toEqual(EMPTY_SCREEN_STATE)
    expect(normalizeScreenState('x')).toEqual(EMPTY_SCREEN_STATE)
    expect(normalizeScreenState({})).toEqual(EMPTY_SCREEN_STATE)
  })

  it('keeps valid fields and sanitizes the rest', () => {
    const s = normalizeScreenState({
      cartOpen: true,
      checkoutOpen: 'yes',
      productId: 'burger',
      feedIndex: 3.7,
      draft: { customerName: 'Ana', customerPhone: 42, tipCents: -5 },
      placedOrder: { id: 'o1', items: [] },
    })
    expect(s.cartOpen).toBe(true)
    expect(s.checkoutOpen).toBe(false)
    expect(s.productId).toBe('burger')
    expect(s.feedIndex).toBe(3)
    expect(s.draft).toMatchObject({ customerName: 'Ana', customerPhone: '', tipCents: 0, deliveryStreet: '' })
    expect(s.placedOrder).toEqual({ id: 'o1', items: [] })
    expect(normalizeScreenState({ feedIndex: -2, placedOrder: { id: 1 } })).toMatchObject({ feedIndex: 0, placedOrder: null })
  })
})

describe('isDraftEmpty', () => {
  const blank = {
    customerName: '', customerPhone: '', orderType: 'dine_in', deliveryStreet: '', deliveryComplement: '',
    deliveryZipcode: '', deliveryCity: '', deliveryNotes: '', tipCents: 0,
  }

  it('is empty until the customer types or changes something', () => {
    expect(isDraftEmpty(blank, 'dine_in')).toBe(true)
    expect(isDraftEmpty({ ...blank, customerName: 'Ana' }, 'dine_in')).toBe(false)
    expect(isDraftEmpty({ ...blank, orderType: 'delivery' }, 'dine_in')).toBe(false)
    expect(isDraftEmpty({ ...blank, tipCents: 200 }, 'dine_in')).toBe(false)
  })
})
