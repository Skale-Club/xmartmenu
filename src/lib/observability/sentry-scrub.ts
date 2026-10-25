/**
 * Strips what Sentry must never receive — cookies, auth headers, keys,
 * passwords — and masks phone numbers and e-mails, before an event leaves
 * the app. Shared by the browser, Node and Edge configs (browser-safe).
 */
type Json = unknown

const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|signature|card|cvc)/i
const PHONE_KEY = /(phone|whatsapp|tel)/i
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length <= 4 ? '••••' : `${digits.slice(0, 2)}•••••${digits.slice(-4)}`
}

export function scrubValue(value: Json, key = '', depth = 0): Json {
  if (SECRET_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') {
    if (PHONE_KEY.test(key)) return maskPhone(value)
    return value.replace(EMAIL, '$1•••@$2')
  }
  if (depth > 5 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => scrubValue(v, key, depth + 1))
  const out: Record<string, Json> = {}
  for (const [k, v] of Object.entries(value as Record<string, Json>)) out[k] = scrubValue(v, k, depth + 1)
  return out
}

interface ScrubbableEvent {
  request?: { headers?: Record<string, string>; cookies?: unknown; data?: Json; query_string?: Json }
  extra?: Record<string, Json>
  contexts?: Record<string, Json>
  user?: { id?: string | number } & Record<string, Json>
}

/** Sentry `beforeSend`: returns the cleaned event. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.request) {
    delete event.request.cookies
    if (event.request.headers) {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(event.request.headers)) {
        if (!SECRET_KEY.test(k)) headers[k] = v
      }
      event.request.headers = headers
    }
    if (event.request.data !== undefined) event.request.data = scrubValue(event.request.data)
    if (event.request.query_string !== undefined) event.request.query_string = scrubValue(event.request.query_string)
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, Json>
  if (event.contexts) event.contexts = scrubValue(event.contexts) as Record<string, Json>
  // Keep the user id (who hit the error), never their email or IP.
  if (event.user) event.user = event.user.id !== undefined ? { id: event.user.id } : {}
  return event
}
