// SEED-014: menu/branch pages reuse the tenant's branded Open Graph card.
// Next.js does not inherit a parent segment's opengraph-image, and route-segment
// config must be statically declared per file — so we import the generator as the
// default (it reads params.slug, present on this nested route) and re-declare config.
import Image from '../opengraph-image'

export const revalidate = 300
export const alt = 'Digital menu'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default Image
