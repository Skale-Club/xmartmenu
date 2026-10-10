// SEED-014: Twitter card image reuses the per-tenant branded Open Graph card.
// Next.js does not derive twitter:image from opengraph-image automatically, and
// route-segment config (revalidate) must be statically declared per file — so we
// import the generator as the default and re-declare the image metadata locally.
import Image from './opengraph-image'

export const revalidate = 300
export const alt = 'Digital menu'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default Image
