/**
 * client.ts - The ONLY network seam to the Xphere `/api/v1/sync` contract.
 *
 * v2.4 Phase 51 / FND-04..06: every byte that leaves XmartMenu for Xphere goes
 * through `postXphereSync`. Isolating the entire network surface here means the
 * (not-yet-finalized) wire contract, the auth headers, the timeout, and the
 * retry classification all live in one file — the Plan 02 worker stays mechanical.
 *
 * Design contract:
 *   - Env-gated (ships dark): when XPHERE_API_URL / XPHERE_API_KEY are unset, OR
 *     XPHERE_SYNC_ENABLED is falsy, the function returns `{ disabled: true }` and
 *     performs NO fetch. Mirrors the fail-open env-presence gate in rate-limit.ts.
 *   - Single attempt only: QStash owns retries/backoff/DLQ, so there is NO retry
 *     loop here — exactly one fetch.
 *   - 10s per-request timeout via AbortSignal.timeout(10_000).
 *   - Typed classification: 5xx/429/network/timeout -> XphereTransientError
 *     (worker -> retry); 4xx -> XpherePermanentError (worker -> 489 DLQ).
 *
 * SECURITY: never log the API key, the Authorization header, or the full headers
 * object. Errors carry only a message + scrubbed numeric status (see errors.ts).
 *
 * Code + comments in English. No barrel.
 */

import type { XphereSyncRequest, XphereSyncResponse } from './types'
import { XphereTransientError, XpherePermanentError } from './errors'

/** Per-request timeout: QStash owns retries, so one attempt gets a hard 10s cap. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Result of a sync attempt. `disabled: true` is a typed dark/no-op sentinel (env
 * gate closed) — the worker treats it as a permanent no-op, never a retry.
 */
export type PostXphereResult =
  | { disabled: true }
  | { disabled: false; response: XphereSyncResponse }

/**
 * True only when both credentials are present AND the kill switch is a truthy,
 * non-'false' value. Mirrors the `hasUpstash` presence-gate shape in rate-limit.ts.
 * `XPHERE_SYNC_ENABLED` is the explicit kill switch so the feature can ship dark
 * even after credentials land.
 */
export function isXphereEnabled(): boolean {
  return (
    !!(process.env.XPHERE_API_URL && process.env.XPHERE_API_KEY) &&
    process.env.XPHERE_SYNC_ENABLED !== 'false' &&
    !!process.env.XPHERE_SYNC_ENABLED
  )
}

/**
 * POST the Phase 50 payload to the shared Xphere `/api/v1/sync` endpoint.
 *
 * @param payload - the upsert request (external_id-keyed, source='xmartmenu').
 * @param opts.idempotencyKey - optional `Idempotency-Key` header value
 *   (e.g. `${tenantId}:${reason}`). The exact header name is not finalized by
 *   Xtimator; it is isolated here and safe to send.
 *
 * @returns `{ disabled: true }` when the env gate is closed (no fetch), or
 *   `{ disabled: false, response }` on a 2xx.
 * @throws XphereTransientError on 5xx/429/network/timeout (worker -> QStash retry).
 * @throws XpherePermanentError on 4xx (worker -> 489 + DLQ).
 */
export async function postXphereSync(
  payload: XphereSyncRequest,
  opts?: { idempotencyKey?: string },
): Promise<PostXphereResult> {
  // 1. Ship dark when the gate is closed — no network, typed sentinel.
  if (!isXphereEnabled()) {
    return { disabled: true }
  }

  // 2. Build headers. The API key never leaves this scope / is never logged.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.XPHERE_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Org-Id': process.env.XPHERE_ORG_ID ?? '',
  }
  if (opts?.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey
  }

  // 3. Single fetch attempt with a hard 10s timeout. A thrown fetch/abort error
  //    (network down, DNS, TLS, AbortSignal.timeout) is transient -> retry.
  let res: Response
  try {
    res = await fetch(process.env.XPHERE_API_URL!, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw new XphereTransientError('xphere request failed', { cause: err })
  }

  // 4. 2xx -> parse the CRM ids and return them.
  if (res.ok) {
    const response = (await res.json()) as XphereSyncResponse
    return { disabled: false, response }
  }

  // 5. Classify non-2xx by status. 5xx + 429 are transient (retry); every other
  //    non-ok status (4xx) is permanent (DLQ).
  if (res.status >= 500 || res.status === 429) {
    throw new XphereTransientError(`xphere ${res.status}`, { status: res.status })
  }
  throw new XpherePermanentError(`xphere ${res.status}`, { status: res.status })
}
