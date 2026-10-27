/**
 * Browser side of order idempotency (EX-03). One key per checkout attempt:
 * the same cart sent again — a double tap, a retry after a lost response —
 * reuses the key, so POST /api/orders answers with the order it already
 * created instead of a second one. A different cart gets a new key.
 */
export interface IdempotencySlot {
  key: string
  fingerprint: string
}

function randomKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** The key to send for this payload, reusing the previous one when the payload is the same. */
export function idempotencyKeyFor(previous: IdempotencySlot | null, payload: unknown): IdempotencySlot {
  const fingerprint = JSON.stringify(payload)
  if (previous && previous.fingerprint === fingerprint) return previous
  return { key: randomKey(), fingerprint }
}
