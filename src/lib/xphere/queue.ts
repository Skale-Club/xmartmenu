/**
 * queue.ts - The ONLY choke point that publishes Xphere sync jobs to QStash.
 *
 * v2.4 Phase 52 / FND-03: every Phase 52 producer wiring (onboarding, Stripe
 * webhooks, Connect, backfill) imports this one `enqueueXphereSync` function.
 * It publishes a THIN `{ tenantId, reason, eventId?, tags? }` message — the
 * worker (src/app/api/internal/xphere-sync/route.ts) fat-reads live tenant state
 * from it, so we never embed a stale snapshot in the queue.
 *
 * FAIL-OPEN by design (mirrors the env-presence gate in rate-limit.ts):
 *   - Ships dark: when QSTASH_TOKEN is unset, OR no destination URL can be
 *     resolved (XPHERE_WORKER_URL / NEXT_PUBLIC_APP_URL both unset), the function
 *     is a silent no-op — NO publish, NO throw.
 *   - Observe-and-swallow: a publish error is logged and swallowed. This function
 *     NEVER throws into its caller. A CRM/QStash outage must never block
 *     onboarding or flip a successful Stripe webhook 200 -> 500.
 *
 * The publish target is resolved the SAME way the worker resolves the URL it
 * verifies the QStash signature against — otherwise signature verification fails.
 *
 * Code + comments in English. No barrel.
 */

import { Client } from '@upstash/qstash'
import type { SyncReason } from './types'

// Fail-open env gate (mirror rate-limit.ts `redis = hasUpstash ? ... : null`):
// create the client only when the token is present; otherwise null -> no-op.
const token = process.env.QSTASH_TOKEN
// baseUrl pins the QStash region (e.g. https://qstash-us-east-1.upstash.io). It
// MUST match the region whose signing keys the worker verifies against. Falls
// back to the SDK default when QSTASH_URL is unset.
const client = token
  ? new Client(process.env.QSTASH_URL ? { token, baseUrl: process.env.QSTASH_URL } : { token })
  : null

/**
 * Resolve the pinned worker URL the SAME way the worker does
 * (src/app/api/internal/xphere-sync/route.ts): XPHERE_WORKER_URL first, else
 * derived from NEXT_PUBLIC_APP_URL. Returning null closes the gate (no publish).
 * Matching this resolution is REQUIRED so the QStash signature the worker
 * verifies against its URL constant lines up with the URL we published to.
 */
function resolveWorkerUrl(): string | null {
  const pinned = process.env.XPHERE_WORKER_URL
  if (pinned) return pinned
  const base = process.env.NEXT_PUBLIC_APP_URL
  return base ? `${base}/api/internal/xphere-sync` : null
}

/**
 * Producer-side kill switch (OBS-02). Authoritative at the source: when
 * XPHERE_SYNC_ENABLED is unset/'false'/'0', producing is a silent no-op
 * BEFORE publish — one env flip halts all syncing with no code change.
 * Safe-dark default: disabled unless explicitly enabled.
 *
 * This mirrors the kill-switch truthiness in client.ts's isXphereEnabled, but
 * gates ONLY on the flag (creds belong to the worker, not the producer), and
 * never throws — it only adds an early silent return, so fail-open is preserved.
 */
function isSyncEnabled(): boolean {
  const flag = process.env.XPHERE_SYNC_ENABLED
  return !!flag && flag !== 'false' && flag !== '0'
}

/** Optional fields forwarded into the thin queue message. */
export interface EnqueueXphereOpts {
  eventId?: string // Stripe event.id — forwarded to the worker's note dedup
  tags?: string[] // status/direction tags (e.g. ['status:active', 'upgrade'])
}

/**
 * Enqueue a single Xphere sync job for a tenant. The ONLY function that
 * publishes to QStash — centralizing the try/catch here makes every call site
 * fail-open for free.
 *
 * @param tenantId - tenants.id (the worker fat-reads live state from it).
 * @param reason - why the sync fired; drives stage selection in the worker.
 * @param opts.eventId - Stripe event.id, forwarded for note dedup.
 * @param opts.tags - status/direction tags forwarded to the opportunity.
 *
 * @returns always resolves to void. Silent no-op when the env gate is closed;
 *   logs-and-swallows any publish error. NEVER throws.
 */
export async function enqueueXphereSync(
  tenantId: string,
  reason: SyncReason,
  opts?: EnqueueXphereOpts,
): Promise<void> {
  // Producer kill switch first (OBS-02): when XPHERE_SYNC_ENABLED is
  // unset/'false'/'0', bail BEFORE any publish — authoritative at the source,
  // one env flip halts all syncing with no code change. Never throws.
  if (!isSyncEnabled()) return
  // Fail-open env gate (mirror rate-limit.ts): no client or no destination URL
  // -> silent no-op. Onboarding / Stripe webhooks keep working.
  const url = resolveWorkerUrl()
  if (!client || !url) return

  try {
    await client.publishJSON({
      url,
      body: {
        tenantId,
        reason,
        // Spread optional fields only when present so the worker's optional
        // zod fields stay truly optional.
        ...(opts?.eventId ? { eventId: opts.eventId } : {}),
        ...(opts?.tags && opts.tags.length > 0 ? { tags: opts.tags } : {}),
      },
      // QStash owns retries/backoff/DLQ.
      retries: 5,
      // 10-min QStash dedup window — collapses a Stripe retry that slips past
      // the idempotency check into a single sync per tenant+reason.
      deduplicationId: `xphere:${tenantId}:${reason}`,
    })
  } catch (err) {
    // NEVER rethrow — a CRM/QStash outage must not break onboarding or flip a
    // Stripe webhook 200 -> 500. Log only (observe-and-swallow).
    console.error('xphere.enqueue_failed', {
      tenantId,
      reason,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
