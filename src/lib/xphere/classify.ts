/**
 * classify.ts - Pure QStash retry-vs-DLQ-vs-ack classification for the worker.
 *
 * v2.4 Phase 51 / FND-06: the single source of truth for the worker's hardest
 * decision — given the outcome of a sync attempt, what HTTP status does the
 * `/api/internal/xphere-sync` route return, and does QStash retry it?
 *
 * Both the Plan 02 route AND the offline gate (scripts/xphere-worker-check.ts)
 * consume this function, so the classification table is asserted exactly where it
 * is used — no duplicated inline literals that could drift apart.
 *
 * Mapping (Pitfall 9: transient -> retry, permanent -> DLQ; Pitfall 5: never
 * advance the sync watermark on failure):
 *   - success / disabled / tenant_gone -> 200, retryable=false  (ack, no retry)
 *   - bad_payload                       -> 489, nonRetryable     (DLQ; retrying a
 *                                          malformed message is pure waste)
 *   - error + XpherePermanentError      -> 489, nonRetryable     (DLQ)
 *   - error + XphereTransientError      -> 500, retryable        (QStash retries)
 *   - error + any other throw           -> 500, retryable        (unknown throws
 *                                          are treated as transient -> retry)
 *
 * PURE module: no I/O, no env reads, no network, no DB. Deterministic and
 * offline-testable with plain fixtures.
 *
 * Code + comments in English. No barrel.
 */

import { XphereTransientError, XpherePermanentError } from './errors'

/**
 * The outcome of a single worker attempt, normalized to the inputs that drive
 * the retry decision. `error` is `unknown` because a catch block may surface any
 * throw — the classifier narrows it.
 */
export type WorkerOutcome =
  | { kind: 'success' }
  | { kind: 'disabled' }
  | { kind: 'tenant_gone' }
  | { kind: 'bad_payload' }
  | { kind: 'error'; error: unknown }

/**
 * The classification verdict. `status` is the exact HTTP status the route
 * returns; `nonRetryable` toggles the `Upstash-NonRetryable-Error` header that
 * sends a message straight to the DLQ.
 */
export interface WorkerVerdict {
  status: 200 | 489 | 500
  nonRetryable: boolean
}

/**
 * Map a worker outcome to its HTTP status + retry disposition. Pure.
 */
export function classifyWorkerOutcome(outcome: WorkerOutcome): WorkerVerdict {
  switch (outcome.kind) {
    case 'success':
    case 'disabled':
    case 'tenant_gone':
      // Ack the message — there is nothing to retry. 2xx tells QStash "done".
      return { status: 200, nonRetryable: false }

    case 'bad_payload':
      // A malformed message will never parse — retrying wastes the budget. DLQ.
      return { status: 489, nonRetryable: true }

    case 'error':
      // Permanent failures (4xx validation / unknown stage / no subscription)
      // dead-letter. XphereTransientError AND any other unexpected throw are
      // treated as transient so QStash retries with its own backoff.
      if (outcome.error instanceof XpherePermanentError) {
        return { status: 489, nonRetryable: true }
      }
      // XphereTransientError is the canonical transient case; any other throw
      // (an unexpected bug, a network module error) is conservatively retried
      // too — both land on a retryable 500.
      if (outcome.error instanceof XphereTransientError) {
        return { status: 500, nonRetryable: false }
      }
      return { status: 500, nonRetryable: false }
  }
}

/**
 * Build the response headers for a verdict. Only a non-retryable (DLQ) verdict
 * emits the `Upstash-NonRetryable-Error` header; retryable verdicts get none.
 */
export function nonRetryableHeaders(v: WorkerVerdict): Record<string, string> {
  return v.nonRetryable ? { 'Upstash-NonRetryable-Error': 'true' } : {}
}
