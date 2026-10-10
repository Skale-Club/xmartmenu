/**
 * errors.ts - Typed Xphere sync errors for QStash retry-vs-DLQ classification.
 *
 * v2.4 Phase 51 / FND-06: the Xphere network seam (client.ts) throws one of these
 * two classes so the Plan 02 worker can mechanically decide whether QStash should
 * retry or dead-letter the message:
 *
 *   - XphereTransientError -> 5xx / 429 / network failure / AbortSignal timeout.
 *     The worker maps this to a non-2xx (HTTP 500) response so QStash retries
 *     with its own backoff schedule.
 *
 *   - XpherePermanentError -> 4xx validation / unknown pipeline stage / malformed
 *     response. The worker maps this to HTTP 489 + `Upstash-NonRetryable-Error: true`
 *     so QStash routes it straight to the DLQ instead of retrying forever.
 *
 * SECURITY (Pitfall: secret leakage into xphere_sync_error): these errors carry
 * ONLY a human message and an OPTIONAL numeric HTTP status. They deliberately do
 * NOT store headers, the API key, or the signed JWT — the scrubbed status is the
 * most that may surface in `tenants.xphere_sync_error`.
 *
 * Code + comments in English. No barrel.
 */

/** Shared constructor options for both Xphere error classes. */
interface XphereErrorOptions {
  /** Scrubbed numeric HTTP status (e.g. 503, 422). Never a header or secret. */
  status?: number
  /** Underlying cause (e.g. a thrown fetch/abort error) for stack chaining. */
  cause?: unknown
}

/**
 * Transient failure — safe to retry. Thrown for 5xx, 429, network errors, and
 * request timeouts. The worker returns a non-2xx so QStash retries.
 */
export class XphereTransientError extends Error {
  /** Scrubbed numeric HTTP status, when one is available. */
  readonly status?: number

  constructor(message: string, opts?: XphereErrorOptions) {
    super(message, { cause: opts?.cause })
    this.name = 'XphereTransientError'
    this.status = opts?.status
  }
}

/**
 * Permanent failure — must NOT be retried. Thrown for 4xx validation, an unknown
 * pipeline stage, or a malformed response. The worker returns 489 +
 * `Upstash-NonRetryable-Error: true` so QStash dead-letters the message.
 */
export class XpherePermanentError extends Error {
  /** Scrubbed numeric HTTP status, when one is available. */
  readonly status?: number

  constructor(message: string, opts?: XphereErrorOptions) {
    super(message, { cause: opts?.cause })
    this.name = 'XpherePermanentError'
    this.status = opts?.status
  }
}
