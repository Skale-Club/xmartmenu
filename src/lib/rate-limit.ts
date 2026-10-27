import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Sliding-window rate limiting backed by Upstash Redis (works across
 * instances). (S11 — Rate limiting & abuse prevention.)
 *
 * Without Redis (not configured, or failing) the limits are enforced in this
 * process's memory instead of being skipped (EX-09). Production runs one
 * container, so the in-memory window is a real limit there; with several
 * instances each one enforces it on its own share of the traffic. The old
 * fail-open behaviour left the paid AI chat, audio transcription and OTP
 * endpoints unlimited whenever Redis was absent.
 */

const hasUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
const redis = hasUpstash ? Redis.fromEnv() : null

const limiters = new Map<string, Ratelimit>()

type Duration = `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

export function durationMs(window: Duration): number {
  const [amount, unit] = window.split(' ') as [string, keyof typeof UNIT_MS]
  return Number(amount) * UNIT_MS[unit]
}

/**
 * Client IP for limits. Production sits behind Cloudflare, which sets
 * cf-connecting-ip to the real client. Otherwise x-forwarded-for is read from
 * the right: each proxy appends the address it received from, so the entry
 * added by our own proxy (TRUSTED_PROXY_HOPS from the end, default 1) is the
 * client, while anything further left was written by the client itself and
 * would let it pick a fresh identity per request.
 */
export function getClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const trusted = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1)
    const ip = hops[Math.max(0, hops.length - trusted)]
    if (ip) return ip
  }
  return req.headers.get('x-real-ip')?.trim() || '0.0.0.0'
}

// ── In-memory fallback ──────────────────────────────────────────────────────
// A sliding log per identifier, bounded: old timestamps are dropped on each
// hit and the oldest identifiers are evicted past MAX_KEYS_PER_LIMITER.
const MAX_KEYS_PER_LIMITER = 10_000
const memory = new Map<string, Map<string, number[]>>()

export function memoryRateLimit(name: string, identifier: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean } {
  let byKey = memory.get(name)
  if (!byKey) {
    byKey = new Map()
    memory.set(name, byKey)
  }
  const recent = (byKey.get(identifier) ?? []).filter((t) => now - t < windowMs)
  const ok = recent.length < limit
  if (ok) recent.push(now)
  byKey.delete(identifier) // re-insert: Map order = least recently used first
  byKey.set(identifier, recent)
  if (byKey.size > MAX_KEYS_PER_LIMITER) {
    const oldest = byKey.keys().next().value
    if (oldest !== undefined) byKey.delete(oldest)
  }
  return { ok }
}

/**
 * Check a sliding-window limit. Returns { ok: false } when the identifier has
 * exceeded `limit` requests within `window`.
 */
export async function rateLimit(
  name: string,
  identifier: string,
  limit: number,
  window: Duration,
): Promise<{ ok: boolean }> {
  // Test runs only (ci.yml e2e job, scripts/e2e-local.mjs): one IP places
  // dozens of orders a minute. Never set in production.
  if (process.env.RATE_LIMIT_MODE === 'off') return { ok: true }
  if (!redis) return memoryRateLimit(name, identifier, limit, durationMs(window))
  let limiter = limiters.get(name)
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `rl:${name}`,
      analytics: false,
    })
    limiters.set(name, limiter)
  }
  try {
    const { success } = await limiter.limit(identifier)
    return { ok: success }
  } catch {
    // Redis unreachable: keep limiting locally rather than letting everything through.
    return memoryRateLimit(name, identifier, limit, durationMs(window))
  }
}
