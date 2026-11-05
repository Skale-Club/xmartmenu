// Zero Node imports: bundled into the Edge middleware, where `pg` cannot run.
// Owned mode asks the Node route /api/internal/resolve-domain instead.
import { normalizeCustomDomainHost } from './data/tenant-domain'

export interface DomainCacheEntry { slug: string | null; expires: number }
export const DOMAIN_HIT_TTL_MS = 60_000
export const DOMAIN_MISS_TTL_MS = 30_000
export const DOMAIN_ERROR_TTL_MS = 5_000
export const DOMAIN_LOOKUP_TIMEOUT_MS = 2_500
export const DOMAIN_CACHE_MAX_ENTRIES = 5_000
export const RESOLVE_DOMAIN_PATH = '/api/internal/resolve-domain'

/** Bounded cache: Host headers are attacker-controlled, so the oldest entries make room. */
export function rememberDomain(cache: Map<string, DomainCacheEntry>, host: string, entry: DomainCacheEntry, max = DOMAIN_CACHE_MAX_ENTRIES) {
  cache.delete(host)
  while (cache.size >= max) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
  cache.set(host, entry)
}

/** Loopback to this same server; never the public origin (proxy, TLS, loops). */
export function internalLookupUrl(host: string, env: Record<string, string | undefined> = process.env) {
  const port = /^\d{1,5}$/.test(env.PORT ?? '') ? env.PORT : '3000'
  return `http://127.0.0.1:${port}${RESOLVE_DOMAIN_PATH}?host=${encodeURIComponent(host)}`
}

/**
 * Cached lookup. A failed lookup is never cached as "no tenant" for long, and a
 * stale positive answer outlives an outage instead of de-routing a live domain.
 */
export async function resolveOwnedDomainSlug(
  host: string,
  cache: Map<string, DomainCacheEntry>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  // Never spend a loopback request (and a pool transaction) on an implausible Host.
  if (!normalizeCustomDomainHost(host)) return null
  const cached = cache.get(host)
  if (cached && cached.expires > now()) return cached.slug
  try {
    const response = await fetcher(internalLookupUrl(host, env), { cache: 'no-store', signal: AbortSignal.timeout(DOMAIN_LOOKUP_TIMEOUT_MS) })
    if (!response.ok) throw new Error('lookup failed')
    const body = await response.json() as { slug?: unknown }
    if (body.slug !== null && typeof body.slug !== 'string') throw new Error('invalid lookup')
    rememberDomain(cache, host, { slug: body.slug, expires: now() + (body.slug ? DOMAIN_HIT_TTL_MS : DOMAIN_MISS_TTL_MS) })
    return body.slug
  } catch {
    const stale = cached?.slug ?? null
    rememberDomain(cache, host, { slug: stale, expires: now() + DOMAIN_ERROR_TTL_MS })
    return stale
  }
}
