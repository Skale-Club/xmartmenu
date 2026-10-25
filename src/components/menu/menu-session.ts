/**
 * What a public menu remembers across reloads on the customer's device.
 *
 * - View (list / feed): lives in the URL (?view=), so a reload, a shared link
 *   and the NFC/feed links all agree. See resolveInitialView.
 * - Cart: localStorage, per tenant + menu, expires after CART_TTL_MS. It
 *   survives closing the tab, but not the evening: a shared device in a
 *   restaurant must not hand one customer's cart to the next.
 * - Screen state (cart/checkout open, the dish being viewed, position in the
 *   feed, what was typed at checkout, the "order placed" screen):
 *   sessionStorage, i.e. this tab only. A reload restores it; a new tab (an NFC
 *   tap, a QR scan) starts clean.
 *
 * Storage access is wrapped: private mode, blocked storage or a full quota
 * just means nothing is remembered, never a broken menu.
 */
import type { IngredientModifications, Product } from '@/types/database'
import { buildCartKey, type CartEditorState, type CartItem } from './menu-utils'

export type MenuView = 'list' | 'feed'

/**
 * The URL wins (?view=feed from an NFC/feed link, or ?view=list once the
 * customer switched — both survive a reload); otherwise the restaurant's
 * default. The feed is only ever chosen when it is enabled.
 */
export function resolveInitialView(args: {
  urlView?: string | null
  defaultView?: string | null
  feedEnabled: boolean
}): MenuView {
  if (!args.feedEnabled) return 'list'
  if (args.urlView === 'feed' || args.urlView === 'list') return args.urlView
  return args.defaultView === 'feed' ? 'feed' : 'list'
}

/** The current URL with ?view= set, every other parameter (lang, table…) kept. */
export function urlWithView(href: string, view: MenuView): string {
  const url = new URL(href)
  url.searchParams.set('view', view)
  return url.toString()
}

// ── Storage ────────────────────────────────────────────────────────────────

export const CART_TTL_MS = 3 * 60 * 60 * 1000
const VERSION = 1

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function cartStorageKey(tenantId: string, menuId: string | null | undefined): string {
  return `xm:cart:v${VERSION}:${tenantId}:${menuId ?? 'default'}`
}

export function sessionStorageKey(tenantId: string, menuId: string | null | undefined): string {
  return `xm:menu-session:v${VERSION}:${tenantId}:${menuId ?? 'default'}`
}

interface Envelope<T> {
  savedAt: number
  data: T
}

export function readStored<T>(storage: StorageLike | null, key: string, now: number, ttlMs?: number): T | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const env = JSON.parse(raw) as Envelope<T>
    if (!env || typeof env.savedAt !== 'number' || !('data' in env)) return null
    if (ttlMs !== undefined && now - env.savedAt > ttlMs) {
      storage.removeItem(key)
      return null
    }
    return env.data
  } catch {
    return null
  }
}

export function writeStored<T>(storage: StorageLike | null, key: string, data: T, now: number): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify({ savedAt: now, data } satisfies Envelope<T>))
  } catch {
    // quota exceeded / storage blocked: nothing to remember, nothing to break
  }
}

export function removeStored(storage: StorageLike | null, key: string): void {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // ignore
  }
}

/** window.localStorage / sessionStorage, or null where unavailable (SSR, blocked). */
export function browserStorage(kind: 'local' | 'session'): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

// ── Cart ───────────────────────────────────────────────────────────────────

export interface StoredCartItem {
  productId: string
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  note?: string
  ingredientModifications?: IngredientModifications | null
  editorState?: CartEditorState | null
}

export function serializeCart(cart: CartItem[]): StoredCartItem[] {
  return cart.map((item) => ({
    productId: item.product.id,
    quantity: item.quantity,
    selectedOptions: item.selectedOptions,
    unitPrice: item.unitPrice,
    note: item.note,
    ingredientModifications: item.ingredientModifications ?? null,
    editorState: item.editorState ?? null,
  }))
}

function hasCustomization(item: StoredCartItem): boolean {
  const mods = item.ingredientModifications
  const modded = !!mods && ((mods.removed?.length ?? 0) + (mods.extras?.length ?? 0) + (mods.added?.length ?? 0)) > 0
  return Object.keys(item.selectedOptions ?? {}).length > 0 || modded
}

/**
 * Rebuilds the cart against the menu as it is now: items whose dish is gone or
 * unavailable are dropped, and a plain item (no options, no ingredient
 * changes) takes the dish's current price. Customized items keep the price
 * computed when they were added; checkout re-prices everything server-side
 * regardless.
 */
export function restoreCart(stored: StoredCartItem[] | null | undefined, products: Product[]): CartItem[] {
  if (!Array.isArray(stored)) return []
  const byId = new Map(products.map((p) => [p.id, p]))
  const restored: CartItem[] = []
  for (const s of stored) {
    const product = s && typeof s.productId === 'string' ? byId.get(s.productId) : undefined
    const quantity = Math.floor(Number(s?.quantity))
    if (!product || !(quantity > 0)) continue
    const selectedOptions = s.selectedOptions && typeof s.selectedOptions === 'object' ? s.selectedOptions : {}
    const cartKey = buildCartKey(product.id, selectedOptions)
    if (restored.some((r) => r.cartKey === cartKey)) continue
    restored.push({
      product,
      quantity: Math.min(quantity, 99),
      selectedOptions,
      unitPrice: hasCustomization({ ...s, selectedOptions }) ? Number(s.unitPrice) || product.price : product.price,
      cartKey,
      note: s.note,
      ingredientModifications: s.ingredientModifications ?? null,
      editorState: s.editorState ?? null,
    })
  }
  return restored
}

// ── Screen state (this tab) ────────────────────────────────────────────────

export interface CheckoutDraft {
  customerName: string
  customerPhone: string
  orderType: string
  deliveryStreet: string
  deliveryComplement: string
  deliveryZipcode: string
  deliveryCity: string
  deliveryNotes: string
  tipCents: number
}

export interface MenuScreenState {
  cartOpen: boolean
  checkoutOpen: boolean
  /** The dish whose detail sheet was open. */
  productId: string | null
  /** Index of the dish on screen in the feed. */
  feedIndex: number
  draft: CheckoutDraft | null
  /** The "order placed" confirmation, kept until the customer dismisses it. */
  placedOrder: { id: string; items: StoredCartItem[] } | null
}

export const EMPTY_SCREEN_STATE: MenuScreenState = {
  cartOpen: false,
  checkoutOpen: false,
  productId: null,
  feedIndex: 0,
  draft: null,
  placedOrder: null,
}

/** Tolerates partial / older / hand-edited values: anything unexpected falls back to the default. */
export function normalizeScreenState(raw: unknown): MenuScreenState {
  if (!raw || typeof raw !== 'object') return EMPTY_SCREEN_STATE
  const r = raw as Partial<MenuScreenState>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const draft = r.draft && typeof r.draft === 'object'
    ? {
        customerName: str(r.draft.customerName),
        customerPhone: str(r.draft.customerPhone),
        orderType: str(r.draft.orderType),
        deliveryStreet: str(r.draft.deliveryStreet),
        deliveryComplement: str(r.draft.deliveryComplement),
        deliveryZipcode: str(r.draft.deliveryZipcode),
        deliveryCity: str(r.draft.deliveryCity),
        deliveryNotes: str(r.draft.deliveryNotes),
        tipCents: Number.isFinite(r.draft.tipCents) ? Math.max(0, Math.floor(r.draft.tipCents as number)) : 0,
      }
    : null
  const placed = r.placedOrder && typeof r.placedOrder === 'object' && typeof r.placedOrder.id === 'string' && Array.isArray(r.placedOrder.items)
    ? { id: r.placedOrder.id, items: r.placedOrder.items }
    : null
  return {
    cartOpen: r.cartOpen === true,
    checkoutOpen: r.checkoutOpen === true,
    productId: typeof r.productId === 'string' ? r.productId : null,
    feedIndex: Number.isFinite(r.feedIndex) ? Math.max(0, Math.floor(r.feedIndex as number)) : 0,
    draft,
    placedOrder: placed,
  }
}

export function isDraftEmpty(d: CheckoutDraft, defaultOrderType: string): boolean {
  return !d.customerName && !d.customerPhone && !d.deliveryStreet && !d.deliveryComplement
    && !d.deliveryZipcode && !d.deliveryCity && !d.deliveryNotes && !d.tipCents
    && (!d.orderType || d.orderType === defaultOrderType)
}
