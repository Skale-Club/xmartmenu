/**
 * Where a request on a restaurant's verified custom domain goes (EX-05).
 * Zero-import, pure: used by the Edge middleware and unit-tested.
 *
 * On a custom domain the restaurant IS the site, so its pages live at the
 * root: "/" is the menu, "/drinks" a menu or branch, "/me", "/blog", "/waiter",
 * "/robots.txt", "/sitemap.xml" and the social images are the restaurant's.
 * Those are rewritten into the tenant namespace (/<slug>/…).
 *
 * Platform routes are global and keep their path: API routes (orders,
 * payments, chat), checkout and its confirmation, auth and OAuth callbacks,
 * onboarding, legal pages, framework and discovery files. Rewriting them (the
 * old behaviour) sent POST /api/orders, /checkout/<id> and /auth/callback to
 * /<slug>/api/…, a 404, so a guest on a custom domain could not order or pay.
 */

const GLOBAL_PREFIXES = [
  '/api/',
  '/checkout/',
  '/auth/',
  '/oauth/',
  '/onboarding',
  '/privacy',
  '/terms',
  '/demo',
  '/_next/',
  '/.well-known/',
  '/monitoring',
]

const GLOBAL_FILES = new Set([
  '/favicon.ico',
  '/icon.png',
  '/apple-icon.png',
  '/manifest.webmanifest',
])

export type CustomDomainRoute =
  | { kind: 'pass' }
  | { kind: 'rewrite'; pathname: string }

function isGlobalPath(pathname: string): boolean {
  if (GLOBAL_FILES.has(pathname)) return true
  return GLOBAL_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * `tenantSlug` is the restaurant owning the host. Returns where the request
 * should be served from. The tenant prefix is matched on a whole segment:
 * "/pizza" on the "pizza" restaurant's domain is already namespaced, but
 * "/pizzas" is a menu called "pizzas".
 */
export function resolveCustomDomainRoute(pathname: string, tenantSlug: string): CustomDomainRoute {
  if (isGlobalPath(pathname)) return { kind: 'pass' }
  const prefix = `/${tenantSlug}`
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return { kind: 'pass' }
  return { kind: 'rewrite', pathname: pathname === '/' ? prefix : `${prefix}${pathname}` }
}
