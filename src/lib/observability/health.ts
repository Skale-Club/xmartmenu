/**
 * Readiness report for /api/health/ready (the plain /api/health stays a
 * no-dependency liveness probe for Docker/Coolify).
 *
 * Public: overall status, database check, release and uptime.
 * With HEALTH_TOKEN: which integrations are configured — as booleans only,
 * never the values.
 */
export interface CheckResult {
  ok: boolean
  latency_ms?: number
  error?: string
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down'
  release: string
  uptime_s: number
  checks: Record<string, CheckResult>
  config?: Record<string, boolean | string>
}

type Env = Record<string, string | undefined>

/** The build's git sha (Docker build arg GIT_SHA → NEXT_PUBLIC_RELEASE). */
export function currentRelease(env: Env = process.env): string {
  return env.NEXT_PUBLIC_RELEASE?.trim() || 'dev'
}

/** Integrations this deployment has configured (no values). */
export function configSummary(env: Env = process.env): Record<string, boolean | string> {
  const set = (key: string) => !!env[key]?.trim()
  return {
    sentry: set('SENTRY_DSN') && set('NEXT_PUBLIC_SENTRY_DSN'),
    openrouter: set('OPENROUTER_API_KEY'),
    stripe: set('STRIPE_SECRET_KEY') && set('STRIPE_WEBHOOK_SECRET'),
    rate_limit_store: set('UPSTASH_REDIS_REST_URL') && set('UPSTASH_REDIS_REST_TOKEN'),
    chat_encryption: set('CHAT_ADDON_ENCRYPTION_KEY'),
    storage: env.STORAGE_PROVIDER?.trim() || 'supabase',
  }
}

/** The database decides up/down; a slow database degrades. */
export function buildHealthReport(args: {
  database: CheckResult
  uptimeSeconds: number
  env?: Env
  includeConfig?: boolean
  slowMs?: number
}): HealthReport {
  const slow = (args.database.latency_ms ?? 0) > (args.slowMs ?? 1500)
  return {
    status: !args.database.ok ? 'down' : slow ? 'degraded' : 'ok',
    release: currentRelease(args.env),
    uptime_s: Math.round(args.uptimeSeconds),
    checks: { database: args.database },
    ...(args.includeConfig ? { config: configSummary(args.env) } : {}),
  }
}

/** Constant-time-ish comparison for the details token. */
export function tokenMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
