/**
 * Request ids: one per incoming request, set by the middleware, returned to
 * the browser in `x-request-id`, written on every log line, Sentry event and
 * audit entry of that request — so one id follows a request everywhere.
 *
 * Edge-safe (used by the middleware): no Node imports.
 */
export const REQUEST_ID_HEADER = 'x-request-id'

/** An id a proxy already assigned (Coolify / Cloudflare), when it looks sane. */
export function normalizeRequestId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && /^[A-Za-z0-9._:-]{8,128}$/.test(trimmed) ? trimmed : null
}

export function newRequestId(): string {
  return crypto.randomUUID()
}

/** The proxy's id when present (so logs line up end to end), else a fresh one. */
export function resolveRequestId(headers: Headers): string {
  return normalizeRequestId(headers.get(REQUEST_ID_HEADER)) ?? normalizeRequestId(headers.get('cf-ray')) ?? newRequestId()
}
