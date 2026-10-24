/**
 * Server-side option pricing, shared by checkout (/api/orders) and the AI chat
 * agent so the price the chat puts in the cart is the price checkout charges.
 *
 * Mirrors ProductModal pricing exactly — single/half base_price REPLACE the
 * running price, multiple modifiers add — resolved by option id from the
 * editor state, never from a client-supplied price.
 */

export type ServerOption = { id: string; base_price: number | null; price_modifier: number }
export type ServerOptionGroup = { id: string; type: string; options: ServerOption[] }

export interface OptionSelectionState {
  singleSelections?: Record<string, string>
  halfSelections?: Record<string, { half1: string | null; half2: string | null }>
  multiSelections?: Record<string, string[]>
}

export function computeOptionUnit(
  basePrice: number,
  ed: OptionSelectionState | null | undefined,
  groups: ServerOptionGroup[],
): number {
  let unit = Number(basePrice ?? 0)
  if (!ed) return unit
  for (const g of groups) {
    if (g.type === 'single') {
      const optId = ed.singleSelections?.[g.id]
      if (optId) {
        const o = g.options.find((x) => x.id === optId)
        if (o) {
          if (o.base_price !== null) unit = Number(o.base_price)
          else unit += Number(o.price_modifier)
        }
      }
    } else if (g.type === 'half_and_half') {
      const half = ed.halfSelections?.[g.id]
      if (half?.half1 && half?.half2) {
        const o1 = g.options.find((x) => x.id === half.half1)
        const o2 = g.options.find((x) => x.id === half.half2)
        unit = Math.max(Number(o1?.base_price ?? 0), Number(o2?.base_price ?? 0))
      }
    } else if (g.type === 'multiple') {
      for (const optId of ed.multiSelections?.[g.id] ?? []) {
        const o = g.options.find((x) => x.id === optId)
        if (o) unit += Number(o.price_modifier)
      }
    }
  }
  return unit
}
