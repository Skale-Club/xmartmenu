/**
 * SEED-019: a private / in-store menu can carry a price multiplier. Every
 * price the guest sees on it — the dish, each size or add-on, each ingredient
 * extra — is scaled the same way and rounded to cents, so the dish sheet and
 * the cart add up to the prices on screen. Checkout (/api/orders) applies the
 * same multiplier to the price it recomputes.
 */

/** Multiplier to apply: anything missing, invalid or ≤ 0 means "no change". */
export function effectiveMultiplier(raw: unknown): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function scalePrice(value: number, multiplier: number): number {
  if (multiplier === 1) return value
  return Math.round(Number(value) * multiplier * 100) / 100
}

export function scaleProducts<T extends { price: number; original_price?: number | null }>(products: T[], multiplier: number): T[] {
  if (multiplier === 1) return products
  return products.map(p => ({
    ...p,
    price: scalePrice(p.price, multiplier),
    ...(p.original_price != null ? { original_price: scalePrice(p.original_price, multiplier) } : {}),
  }))
}

export function scaleOptionGroups<G extends { options: Array<{ base_price: number | null; price_modifier: number }> }>(groups: G[], multiplier: number): G[] {
  if (multiplier === 1) return groups
  return groups.map(group => ({
    ...group,
    options: group.options.map(option => ({
      ...option,
      base_price: option.base_price === null || option.base_price === undefined ? option.base_price : scalePrice(option.base_price, multiplier),
      price_modifier: scalePrice(option.price_modifier ?? 0, multiplier),
    })),
  }))
}

export function scaleProductIngredients<
  P extends { extra_price_override: number | null; add_price_override: number | null; ingredient: { default_extra_price: number; default_add_price: number } },
>(items: P[], multiplier: number): P[] {
  if (multiplier === 1) return items
  return items.map(pi => ({
    ...pi,
    extra_price_override: pi.extra_price_override === null ? null : scalePrice(pi.extra_price_override, multiplier),
    add_price_override: pi.add_price_override === null ? null : scalePrice(pi.add_price_override, multiplier),
    ingredient: {
      ...pi.ingredient,
      default_extra_price: scalePrice(pi.ingredient.default_extra_price, multiplier),
      default_add_price: scalePrice(pi.ingredient.default_add_price, multiplier),
    },
  }))
}
