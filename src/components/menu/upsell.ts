/**
 * "Complete your order": the steps offered after a guest adds a dish, like a
 * counter asking "any fries with that? a drink? dessert?".
 *
 * Built from what the restaurant set up:
 * - dishes it hand-picked for this one (products.upsell_product_ids), first;
 * - then, when the dish is a main course, one step per course the guest does
 *   not have yet — sides, drinks, desserts — from the categories marked with
 *   that course (categories.course).
 *
 * Pure: MenuPage passes the menu in the guest's language and current cart.
 */
import type { Category, Product } from '@/types/database'

export type Course = 'main' | 'side' | 'drink' | 'dessert'
export const COURSES: readonly Course[] = ['main', 'side', 'drink', 'dessert']

/** What a main course is followed by, in this order. */
const FOLLOW_UPS: readonly Course[] = ['side', 'drink', 'dessert']

export type UpsellStepKind = 'pairs' | 'side' | 'drink' | 'dessert'

export interface UpsellStep {
  kind: UpsellStepKind
  products: Product[]
}

export const MAX_SUGGESTIONS_PER_STEP = 4
export const MAX_UPSELL_STEPS = 3

export function parseCourse(value: unknown): Course | null {
  return typeof value === 'string' && (COURSES as readonly string[]).includes(value) ? (value as Course) : null
}

export function buildUpsellSteps(args: {
  added: Product
  /** Product ids in the cart, including the one just added. */
  cartProductIds: Iterable<string>
  /** The menu on screen, in display order (only available dishes). */
  products: Product[]
  categories: Array<Pick<Category, 'id'> & { course?: string | null }>
  maxPerStep?: number
}): UpsellStep[] {
  const maxPerStep = args.maxPerStep ?? MAX_SUGGESTIONS_PER_STEP
  const courseByCategory = new Map<string, Course>()
  for (const category of args.categories) {
    const course = parseCourse(category.course)
    if (course) courseByCategory.set(category.id, course)
  }
  const courseOf = (product: Product): Course | null =>
    product.category_id ? courseByCategory.get(product.category_id) ?? null : null

  const inCart = new Set(args.cartProductIds)
  const byId = new Map(args.products.map(p => [p.id, p]))
  const used = new Set<string>([args.added.id])
  const steps: UpsellStep[] = []

  // Featured dishes first, otherwise the menu's own order.
  const rank = (list: Product[]) => [...list].sort((a, b) => Number(b.is_featured) - Number(a.is_featured))

  const picks = (args.added.upsell_product_ids ?? [])
    .map(id => byId.get(id))
    .filter((p): p is Product => !!p && !inCart.has(p.id) && !used.has(p.id))
    .slice(0, maxPerStep)
  if (picks.length) {
    picks.forEach(p => used.add(p.id))
    steps.push({ kind: 'pairs', products: picks })
  }

  if (courseOf(args.added) === 'main') {
    const coursesInCart = new Set<Course>()
    for (const id of inCart) {
      const product = byId.get(id)
      const course = product ? courseOf(product) : null
      if (course) coursesInCart.add(course)
    }
    for (const course of FOLLOW_UPS) {
      if (coursesInCart.has(course)) continue
      const options = rank(args.products.filter(p => courseOf(p) === course && !used.has(p.id) && !inCart.has(p.id)))
        .slice(0, maxPerStep)
      if (!options.length) continue
      options.forEach(p => used.add(p.id))
      steps.push({ kind: course as UpsellStepKind, products: options })
    }
  }

  return steps.slice(0, MAX_UPSELL_STEPS)
}

/**
 * Whether a suggestion can go straight into the cart from the sequence.
 * Dishes with required choices (size, flavour…) open their details instead.
 */
export function canQuickAdd(optionGroups: Array<{ required?: boolean | null; min_selections?: number | null }> | undefined): boolean {
  return !(optionGroups ?? []).some(group => group.required || (group.min_selections ?? 0) > 0)
}
