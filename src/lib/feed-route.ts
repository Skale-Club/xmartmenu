const SLUG_SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*'
const PLATFORM_FEED_PATH = new RegExp(`^/feed/(${SLUG_SEGMENT})(?:/(${SLUG_SEGMENT}))?/?$`)
const CUSTOM_DOMAIN_FEED_PATH = new RegExp(`^/feed(?:/(${SLUG_SEGMENT}))?/?$`)

/**
 * Resolve a public feed URL to the existing menu route that renders it.
 *
 * Platform host:
 *   /feed/:tenant              -> /:tenant
 *   /feed/:tenant/:menuOrStore -> /:tenant/:menuOrStore
 *
 * Verified custom domain:
 *   /feed              -> /:tenant
 *   /feed/:menuOrStore -> /:tenant/:menuOrStore
 */
export function resolveFeedRewritePath(pathname: string, tenantSlug: string | null): string | null {
  if (tenantSlug) {
    const match = pathname.match(CUSTOM_DOMAIN_FEED_PATH)
    if (!match) return null
    return match[1] ? `/${tenantSlug}/${match[1]}` : `/${tenantSlug}`
  }

  const match = pathname.match(PLATFORM_FEED_PATH)
  if (!match) return null
  return match[2] ? `/${match[1]}/${match[2]}` : `/${match[1]}`
}
