import { baseName } from '@/lib/menu-translations'
import type { CartEditorState } from './menu-utils'

/** One size of a dish, on the feed. */
export interface FeedSize {
  id: string
  /** What the guest reads (localized). */
  label: string
  price: number
  /** What the cart and the kitchen get: { "Size": "Slice" }, in the base language. */
  selectedOptions: Record<string, string>
  /** Lets "Edit" in the order drawer reopen the dish on this size. */
  editorState: CartEditorState
}

interface SizeGroup {
  id: string
  name: string
  base_name?: string
  type: string
  required: boolean
  options: Array<{ id: string; name: string; base_name?: string; base_price: number | null; price_modifier: number; is_available?: boolean }>
}

/**
 * The sizes of a dish whose only required choice is a size (a single-choice
 * group whose options set the price): on the feed "Add to order" opens a small
 * sheet to pick the size, then puts it straight into the cart. A dish
 * with any other required choice returns [] and keeps opening its sheet.
 */
export function feedSizes(productPrice: number, groups: readonly SizeGroup[] | undefined): FeedSize[] {
  const required = (groups ?? []).filter(group => group.required)
  if (required.length !== 1) return []
  const [group] = required
  if (group.type !== 'single') return []
  const options = group.options.filter(option => option.is_available !== false)
  if (options.length === 0 || !options.some(option => option.base_price !== null && option.base_price !== undefined)) return []

  return options.map(option => ({
    id: option.id,
    label: option.name,
    price: option.base_price !== null && option.base_price !== undefined
      ? Number(option.base_price)
      : (Number(productPrice) || 0) + (Number(option.price_modifier) || 0),
    selectedOptions: { [baseName(group)]: baseName(option) },
    editorState: {
      singleSelections: { [group.id]: option.id },
      halfSelections: {},
      multiSelections: {},
      ingredientSteppers: {},
      addedIngredients: [],
      note: '',
    },
  }))
}
