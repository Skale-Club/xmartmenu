/**
 * Server-side option pricing, shared by checkout (/api/orders) and the AI chat
 * agent so the price the chat puts in the cart is the price checkout charges.
 *
 * Mirrors ProductModal pricing — single/half base_price REPLACE the running
 * price, multiple modifiers add — resolved by option id from the editor state,
 * never from a client-supplied price.
 *
 * resolveOptionSelection() is strict: an option id that is not an available
 * option of that group of that product, a missing required choice, too many or
 * duplicated picks are errors, never a substitute price. A lenient resolver
 * that skipped unknown ids priced a half-and-half pizza at zero.
 */

export type ServerOption = {
  id: string
  name?: string
  base_price: number | null
  price_modifier: number
  is_available?: boolean | null
}
export type ServerOptionGroup = {
  id: string
  name?: string
  type: string
  required?: boolean | null
  min_selections?: number | null
  max_selections?: number | null
  options: ServerOption[]
}

export interface OptionSelectionState {
  singleSelections?: Record<string, string>
  halfSelections?: Record<string, { half1: string | null; half2: string | null }>
  multiSelections?: Record<string, string[]>
}

export type OptionSelectionErrorCode =
  | 'unknown_group'
  | 'unknown_option'
  | 'unavailable_option'
  | 'missing_required'
  | 'incomplete_half'
  | 'too_few'
  | 'too_many'
  | 'duplicate_option'

export class OptionSelectionError extends Error {
  constructor(readonly code: OptionSelectionErrorCode, readonly groupId: string, message: string) {
    super(message)
    this.name = 'OptionSelectionError'
  }
}

/**
 * Price of a half-and-half choice: the dearer half. A half without its own
 * base price counts as the dish price, never as zero (ProductModal uses this
 * too, so the screen and checkout agree).
 */
export function halfAndHalfUnit(basePrice: number, half1: { base_price: number | null } | undefined, half2: { base_price: number | null } | undefined): number {
  const price = (o: { base_price: number | null } | undefined) => Number(o?.base_price ?? basePrice)
  return Math.max(price(half1), price(half2))
}

function optionOf(group: ServerOptionGroup, optionId: unknown): ServerOption {
  const option = typeof optionId === 'string' ? group.options.find((o) => o.id === optionId) : undefined
  if (!option) throw new OptionSelectionError('unknown_option', group.id, `Unknown option for "${group.name ?? group.id}"`)
  if (option.is_available === false) {
    throw new OptionSelectionError('unavailable_option', group.id, `"${option.name ?? option.id}" is no longer available`)
  }
  return option
}

export interface ResolvedOptions {
  /** Unit price before ingredients and the menu multiplier. */
  unit: number
  /** { group name: chosen option name(s) } from the catalog, for the kitchen and the receipt. */
  labels: Record<string, string>
}

export function resolveOptionSelection(
  basePrice: number,
  ed: OptionSelectionState | null | undefined,
  groups: ServerOptionGroup[],
): ResolvedOptions {
  const single = ed?.singleSelections ?? {}
  const half = ed?.halfSelections ?? {}
  const multi = ed?.multiSelections ?? {}

  const groupIds = new Set(groups.map((g) => g.id))
  for (const id of [...Object.keys(single), ...Object.keys(half), ...Object.keys(multi)]) {
    if (!groupIds.has(id)) throw new OptionSelectionError('unknown_group', id, 'Option group does not belong to this product')
  }

  let unit = Number(basePrice ?? 0)
  const labels: Record<string, string> = {}
  for (const g of groups) {
    const label = g.name ?? g.id
    if (g.type === 'single') {
      const optId = single[g.id]
      if (!optId) {
        if (g.required) throw new OptionSelectionError('missing_required', g.id, `Choose "${label}"`)
        continue
      }
      const o = optionOf(g, optId)
      if (o.base_price !== null && o.base_price !== undefined) unit = Number(o.base_price)
      else unit += Number(o.price_modifier ?? 0)
      labels[label] = o.name ?? o.id
    } else if (g.type === 'half_and_half') {
      const h = half[g.id]
      if (!h?.half1 && !h?.half2) {
        if (g.required) throw new OptionSelectionError('missing_required', g.id, `Choose "${label}"`)
        continue
      }
      if (!h.half1 || !h.half2) {
        // ProductModal ignores a half-picked optional group (no price, no label); do the same.
        if (!g.required) continue
        throw new OptionSelectionError('incomplete_half', g.id, `Choose both halves of "${label}"`)
      }
      const o1 = optionOf(g, h.half1)
      const o2 = optionOf(g, h.half2)
      unit = halfAndHalfUnit(basePrice, o1, o2)
      labels[label] = `${o1.name ?? o1.id} / ${o2.name ?? o2.id}`
    } else if (g.type === 'multiple') {
      const picked = multi[g.id] ?? []
      if (!Array.isArray(picked)) throw new OptionSelectionError('unknown_option', g.id, `Invalid choice for "${label}"`)
      if (new Set(picked).size !== picked.length) throw new OptionSelectionError('duplicate_option', g.id, `Repeated choice in "${label}"`)
      const min = g.required ? Math.max(1, Number(g.min_selections ?? 1)) : 0
      if (picked.length < min) throw new OptionSelectionError('too_few', g.id, `Choose at least ${min} in "${label}"`)
      if (g.max_selections != null && picked.length > g.max_selections) {
        throw new OptionSelectionError('too_many', g.id, `Choose at most ${g.max_selections} in "${label}"`)
      }
      const names: string[] = []
      for (const optId of picked) {
        const o = optionOf(g, optId)
        unit += Number(o.price_modifier ?? 0)
        names.push(o.name ?? o.id)
      }
      if (names.length) labels[label] = names.join(', ')
    }
  }
  return { unit, labels }
}
