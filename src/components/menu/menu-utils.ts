import type { Product, IngredientModifications } from '@/types/database'

export function getProductImages(product: Product) {
  const fromArray = (product.image_urls ?? []).map(url => url?.trim()).filter(Boolean) as string[]
  const fromSingle = product.image_url?.trim() ? [product.image_url.trim()] : []
  return Array.from(new Set([...fromArray, ...fromSingle]))
}

export function isProductVisibleInFeed(product: { show_in_feed?: boolean | null }) {
  return product.show_in_feed !== false
}

export const FEED_IMAGE_SLIDE_DURATION_MS = 12_000
export const FEED_VIDEO_SLIDE_DURATION_MS = 22_500

export function orderFeedMedia<T extends { type: 'image' | 'video'; display_order: number }>(media: readonly T[]) {
  return [...media].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'video' ? -1 : 1
    return a.display_order - b.display_order
  })
}

export function getFeedSlideDuration(mediaType: 'image' | 'video') {
  return mediaType === 'video' ? FEED_VIDEO_SLIDE_DURATION_MS : FEED_IMAGE_SLIDE_DURATION_MS
}

// Customer-facing text lives in menu-i18n.ts.

// Raw ProductModal selection state, kept on the cart item so the customer can
// re-open the customization flow ("Edit") with all choices pre-filled.
export interface CartEditorState {
  singleSelections: Record<string, string>
  halfSelections: Record<string, { half1: string | null; half2: string | null }>
  multiSelections: Record<string, string[]>
  ingredientSteppers: Record<string, number>
  addedIngredients: string[]
  note: string
}

export interface CartItem {
  product: Product
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  cartKey: string
  note?: string  // per-item customer note | does NOT affect buildCartKey
  ingredientModifications?: IngredientModifications | null  // INGR-09: per D-07 slot metadata
  editorState?: CartEditorState | null  // raw selections for the Edit flow | does NOT affect buildCartKey
}

export function buildCartKey(productId: string, selectedOptions: Record<string, unknown>): string {
  return `${productId}::${JSON.stringify(
    Object.fromEntries(Object.entries(selectedOptions).sort(([a], [b]) => a.localeCompare(b)))
  )}`
}

// Compact "Key: value" list of the chosen option groups, skipping empty values.
export function summarizeOptions(selectedOptions: Record<string, unknown>): string {
  return Object.entries(selectedOptions)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

// Human-readable labels for ingredient changes, e.g. ["No Onion", "Extra Cheese", "+ Bacon"],
// worded in the guest's language when its labels are passed.
export function summarizeIngredientMods(
  mods: IngredientModifications | null | undefined,
  labels: { withoutNamed: string; extraNamed: string; addedNamed: string } = { withoutNamed: 'No {name}', extraNamed: 'Extra {name}', addedNamed: '+ {name}' },
): string[] {
  if (!mods) return []
  const say = (template: string, name: string, qty = 1) =>
    template.replace('{name}', name) + (qty > 1 ? ` ×${qty}` : '')
  const out: string[] = []
  for (const r of mods.removed ?? []) out.push(say(labels.withoutNamed, r.name))
  for (const e of mods.extras ?? []) out.push(say(labels.extraNamed, e.name, e.qty))
  for (const a of mods.added ?? []) out.push(say(labels.addedNamed, a.name, a.qty))
  return out
}
