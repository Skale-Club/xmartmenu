/**
 * The waiter app's order for one table (pure). A line is a dish with the
 * choices made in the dish sheet (ProductModal) — sizes, add-ons, ingredient
 * changes, a note — and is sent to POST /api/orders in the same shape as the
 * guest checkout, so the server prices it the same way (option-pricing.ts).
 */
import type { IngredientModifications, Product } from '@/types/database'
import { buildCartKey, type CartEditorState } from '@/components/menu/menu-utils'
import { baseName } from '@/lib/menu-translations'

export interface WaiterLine {
  key: string
  product: Product
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  note?: string
  ingredientModifications?: IngredientModifications | null
  editorState?: CartEditorState | null
}

export type NewWaiterLine = Omit<WaiterLine, 'key'>

/** Same dish, same choices, same changes, same note = same line. */
export function waiterLineKey(line: Pick<WaiterLine, 'product' | 'selectedOptions' | 'note' | 'ingredientModifications'>): string {
  const mods = line.ingredientModifications
  const modsKey = mods && ((mods.removed?.length ?? 0) + (mods.extras?.length ?? 0) + (mods.added?.length ?? 0)) > 0
    ? JSON.stringify(mods)
    : ''
  return `${buildCartKey(line.product.id, line.selectedOptions)}::${modsKey}::${line.note?.trim() ?? ''}`
}

export function addWaiterLine(cart: WaiterLine[], line: NewWaiterLine): WaiterLine[] {
  const key = waiterLineKey(line)
  const quantity = Math.max(1, Math.floor(line.quantity))
  if (cart.some(l => l.key === key)) {
    return cart.map(l => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l))
  }
  return [...cart, { ...line, key, quantity: Math.min(99, quantity) }]
}

/** +1 / -1 on a line; at 0 the line goes away. */
export function changeWaiterLine(cart: WaiterLine[], key: string, delta: number): WaiterLine[] {
  return cart
    .map(l => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + delta) } : l))
    .filter(l => l.quantity > 0)
}

/** Lines of a dish with no choices (the +/- on the dish row). */
export function plainLineKey(product: Product): string {
  return waiterLineKey({ product, selectedOptions: {}, note: undefined, ingredientModifications: null })
}

export function quantityOfProduct(cart: WaiterLine[], productId: string): number {
  return cart.filter(l => l.product.id === productId).reduce((sum, l) => sum + l.quantity, 0)
}

export function waiterCartTotal(cart: WaiterLine[]): number {
  return cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
}

/** Items for POST /api/orders, in the guest checkout's shape. */
export function waiterOrderItems(cart: WaiterLine[]) {
  return cart.map(l => ({
    product_id: l.product.id,
    product_name: baseName(l.product),
    quantity: l.quantity,
    unit_price: l.unitPrice,
    notes: l.note?.trim() || undefined,
    selected_options: l.selectedOptions,
    ingredient_modifications: l.ingredientModifications || null,
    editor_state: l.editorState || null,
  }))
}

/** A dish with choices to make opens the dish sheet; anything else is added straight away. */
export function needsDishSheet(
  optionGroupCount: number,
  ingredientCount: number,
  capabilities: { ingredientCustomization: boolean },
): boolean {
  return optionGroupCount > 0 || (capabilities.ingredientCustomization && ingredientCount > 0)
}
