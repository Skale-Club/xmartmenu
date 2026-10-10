import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Sliding-window rate limiting backed by Upstash Redis (works across serverless
 * instances). (S11 — Rate limiting & abuse prevention.)
 *
 * FAIL-OPEN by design: when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * not set, rateLimit() always allows the request, so the app keeps working until
 * the backend is provisioned. Set both env vars (Vercel + .env.local) to activate.
 */

const hasUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
const redis = hasUpstash ? Redis.fromEnv() : null

const limiters = new Map<string, Ratelimit>()

type Duration = `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || '0.0.0.0'
}

/**
 * Check a sliding-window limit. Returns { ok: false } when the identifier has
 * exceeded `limit` requests within `window`. Fails open on missing config or
 * backend errors so legitimate traffic is never blocked by infra problems.
 */
export async function rateLimit(
  name: string,
  identifier: string,
  limit: number,
  window: Duration,
): Promise<{ ok: boolean }> {
  if (!redis) return { ok: true }
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
    return { ok: true }
  }
}
