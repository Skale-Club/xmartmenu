/**
 * Structured logs: one JSON object per line on stdout/stderr, which Coolify
 * (and any log shipper) collects and can search by field:
 *
 *   {"ts":"…","level":"error","event":"orders.create_failed","request_id":"…",
 *    "route":"POST /api/orders","tenant_id":"…","actor_id":"…","err":{…}}
 *
 * Fields of the current request (request_id, route, tenant, actor) are added
 * automatically. Values under secret-looking keys are redacted, and phone
 * numbers / emails are never logged in full.
 */
import { getRequestContext } from './context'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|signature)/i

function minLevel(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined
  return LEVELS[configured ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info')] ?? LEVELS.info
}

export function serializeError(error: unknown): LogFields | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) {
    const extra = error as Error & { code?: unknown; status?: unknown; details?: unknown }
    return {
      name: error.name,
      message: error.message,
      ...(extra.code !== undefined ? { code: extra.code } : {}),
      ...(extra.status !== undefined ? { status: extra.status } : {}),
      stack: error.stack?.split('\n').slice(0, 8).join('\n'),
    }
  }
  if (typeof error === 'object') {
    // Supabase/PostgREST errors are plain objects: { message, code, details, hint }.
    const { message, code, details, hint } = error as Record<string, unknown>
    return { message: String(message ?? JSON.stringify(error)).slice(0, 500), code, details, hint }
  }
  return { message: String(error).slice(0, 500) }
}

/** Redacts secrets, recursively (bounded), so a careless field never leaks a key. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1))
  const out: LogFields = {}
  for (const [key, v] of Object.entries(value as LogFields)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(v, depth + 1)
  }
  return out
}

/** Builds the JSON line (exported for tests). */
export function formatLogLine(level: LogLevel, event: string, fields: LogFields = {}, now = new Date()): string {
  const context = getRequestContext()
  const { err, error, ...rest } = fields
  const line: LogFields = {
    ts: now.toISOString(),
    level,
    event,
    ...(context ? {
      request_id: context.requestId,
      route: context.route,
      ...(context.tenantId ? { tenant_id: context.tenantId } : {}),
      ...(context.actorId ? { actor_id: context.actorId } : {}),
    } : {}),
    ...(redact(rest) as LogFields),
  }
  const serialized = serializeError(err ?? error)
  if (serialized) line.err = serialized
  return JSON.stringify(line)
}

function write(level: LogLevel, event: string, fields?: LogFields) {
  if (LEVELS[level] < minLevel()) return
  const line = formatLogLine(level, event, fields)
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const log = {
  debug: (event: string, fields?: LogFields) => write('debug', event, fields),
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
}

/** "+5511987654321" → "+55•••••4321": enough to tell numbers apart, not to call. */
export function maskPhoneForLog(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/\D/g, '')
  return digits.length <= 4 ? '••••' : `${phone.startsWith('+') ? '+' : ''}${digits.slice(0, 2)}•••••${digits.slice(-4)}`
}
