/**
 * Extra photos shown after a dish's own photos, for restaurants whose second
 * photo (the whole cake, the full tray) is not in the catalog. Keyed by the
 * restaurant's slug, then by the dish's name; a dish without an entry has none.
 */
const EXTRA_PHOTOS_BY_SLUG: Record<string, Record<string, string>> = {
  // Whole-cake photos are added here as they arrive.
  'celes-confections': {},
}

export function extraDishImagesFor(
  slug: string | null | undefined,
  product: { name: string },
): string[] {
  const photo = slug ? EXTRA_PHOTOS_BY_SLUG[slug]?.[product.name] : undefined
  return photo ? [photo] : []
}
