import type { CheckResult } from '../observability/health'
import type { AdminMenuQuery } from './admin-menus'

export const OWNED_DATABASE_PROBE_TIMEOUT_MS = 3000

/**
 * Readiness for owned mode: one trivial read on the application's own
 * PostgreSQL, through the same pool the back office uses. The message is fixed
 * because this endpoint is public and a driver error can name hosts or users.
 */
export async function checkOwnedDatabase(
  run: (operation: (query: AdminMenuQuery) => Promise<unknown>) => Promise<unknown>,
  now: () => number = () => performance.now(),
): Promise<CheckResult> {
  const started = now()
  try {
    // `plans` mirrors the legacy probe: it proves the schema and the grant, not just the socket.
    await run(query => query('SELECT id FROM public.plans LIMIT 1'))
    return { ok: true, latency_ms: Math.round(now() - started) }
  } catch {
    return { ok: false, latency_ms: Math.round(now() - started), error: 'database unavailable' }
  }
}
