import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeRequestId, resolveRequestId } from '@/lib/observability/request-id'
import { formatLogLine, maskPhoneForLog, redact, serializeError } from '@/lib/observability/log'
import { getRequestContext, runWithRequestContext, setRequestContext } from '@/lib/observability/context'
import { withApi } from '@/lib/observability/with-api'
import { scrubEvent, scrubValue } from '@/lib/observability/sentry-scrub'
import { buildHealthReport, configSummary, tokenMatches } from '@/lib/observability/health'
import { summarizeChanges } from '@/lib/observability/audit-format'

afterEach(() => vi.restoreAllMocks())

describe('request ids', () => {
  it('keeps a sane id from the proxy, else makes one', () => {
    expect(normalizeRequestId('abc-123_DEF.9:x')).toBe('abc-123_DEF.9:x')
    expect(normalizeRequestId('short')).toBeNull()
    expect(normalizeRequestId('bad id with spaces')).toBeNull()
    expect(normalizeRequestId('x'.repeat(200))).toBeNull()

    expect(resolveRequestId(new Headers({ 'x-request-id': 'proxy-req-123456' }))).toBe('proxy-req-123456')
    expect(resolveRequestId(new Headers({ 'cf-ray': '8f0a1b2c3d4e5f60-GRU' }))).toBe('8f0a1b2c3d4e5f60-GRU')
    expect(resolveRequestId(new Headers())).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('structured logs', () => {
  it('writes one JSON object with the request context', () => {
    const line = runWithRequestContext({ requestId: 'req-12345678', route: 'POST /api/orders' }, () => {
      setRequestContext({ tenantId: 't-1', actorId: 'u-1' })
      return formatLogLine('error', 'orders.create_error', { order_id: 'o-1', err: new Error('boom') }, new Date('2026-10-25T12:00:00Z'))
    })
    const parsed = JSON.parse(line)
    expect(parsed).toMatchObject({
      ts: '2026-10-25T12:00:00.000Z',
      level: 'error',
      event: 'orders.create_error',
      request_id: 'req-12345678',
      route: 'POST /api/orders',
      tenant_id: 't-1',
      actor_id: 'u-1',
      order_id: 'o-1',
      err: { name: 'Error', message: 'boom' },
    })
  })

  it('works outside a request, without context fields', () => {
    const parsed = JSON.parse(formatLogLine('info', 'cron.tick', { n: 1 }))
    expect(parsed.request_id).toBeUndefined()
    expect(parsed).toMatchObject({ event: 'cron.tick', n: 1 })
  })

  it('redacts secrets at any depth and serializes Supabase errors', () => {
    expect(redact({ apiKey: 'k', nested: { password: 'p', ok: 1 }, list: [{ token: 't' }] })).toEqual({
      apiKey: '[redacted]', nested: { password: '[redacted]', ok: 1 }, list: [{ token: '[redacted]' }],
    })
    expect(serializeError({ message: 'duplicate key', code: '23505', details: 'Key (slug)', hint: null })).toMatchObject({ message: 'duplicate key', code: '23505' })
    expect(serializeError('plain')).toEqual({ message: 'plain' })
    expect(maskPhoneForLog('+55 11 98765-4321')).toBe('+55•••••4321')
  })
})

describe('withApi', () => {
  it('opens the request context and returns the request id header', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    let seen: string | undefined
    const handler = withApi('GET /api/x', async () => {
      seen = getRequestContext()?.requestId
      return Response.json({ ok: true })
    })
    const response = await handler(new Request('http://localhost/api/x', { headers: { 'x-request-id': 'req-abcdefgh' } }), undefined)
    expect(seen).toBe('req-abcdefgh')
    expect(response.headers.get('x-request-id')).toBe('req-abcdefgh')
  })

  it('turns a throw into a 500 carrying the request id, and logs it', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const handler = withApi('POST /api/boom', async () => { throw new Error('kaboom') })
    const response = await handler(new Request('http://localhost/api/boom', { method: 'POST', headers: { 'x-request-id': 'req-boom-1234' } }), undefined)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error', request_id: 'req-boom-1234' })
    const logged = stderr.mock.calls.map(([chunk]) => JSON.parse(String(chunk)))
    expect(logged.map(l => l.event)).toEqual(['http.unhandled_error', 'http.request'])
    expect(logged[0]).toMatchObject({ request_id: 'req-boom-1234', err: { message: 'kaboom' } })
    expect(logged[1]).toMatchObject({ status: 500, route: 'POST /api/boom' })
  })
})

describe('Sentry scrubbing', () => {
  it('drops cookies and auth headers, masks phones and e-mails, keeps only the user id', () => {
    const event = scrubEvent({
      request: {
        headers: { authorization: 'Bearer x', cookie: 'sb=1', 'user-agent': 'UA' },
        cookies: { sb: '1' },
        data: { customer_phone: '+5511987654321', note: 'mail me at ana@example.com', stripe_secret: 'sk' },
      },
      user: { id: 'u-1', email: 'ana@example.com', ip_address: '1.2.3.4' },
      extra: { api_key: 'k' },
    })
    expect(event.request?.headers).toEqual({ 'user-agent': 'UA' })
    expect(event.request?.cookies).toBeUndefined()
    expect(event.request?.data).toEqual({ customer_phone: '55•••••4321', note: 'mail me at a•••@example.com', stripe_secret: '[redacted]' })
    expect(event.user).toEqual({ id: 'u-1' })
    expect(event.extra).toEqual({ api_key: '[redacted]' })
    expect(scrubValue(['a@b.co'])).toEqual(['a•••@b.co'])
  })
})

describe('health report', () => {
  it('is down without the database, degraded when slow, ok otherwise', () => {
    expect(buildHealthReport({ database: { ok: false, error: 'x' }, uptimeSeconds: 1, env: {} }).status).toBe('down')
    expect(buildHealthReport({ database: { ok: true, latency_ms: 2000 }, uptimeSeconds: 1, env: {} }).status).toBe('degraded')
    const ok = buildHealthReport({ database: { ok: true, latency_ms: 20 }, uptimeSeconds: 12.4, env: { NEXT_PUBLIC_RELEASE: 'abc123' } })
    expect(ok).toEqual({ status: 'ok', release: 'abc123', uptime_s: 12, checks: { database: { ok: true, latency_ms: 20 } } })
  })

  it('shows integrations only with the token, as booleans', () => {
    const env = { SENTRY_DSN: 'x', NEXT_PUBLIC_SENTRY_DSN: 'x', OPENROUTER_API_KEY: 'k', STORAGE_PROVIDER: 's3' }
    const report = buildHealthReport({ database: { ok: true }, uptimeSeconds: 0, env, includeConfig: true })
    expect(report.config).toEqual(configSummary(env))
    expect(report.config).toMatchObject({ sentry: true, openrouter: true, stripe: false, storage: 's3' })
    expect(JSON.stringify(report)).not.toContain('"k"')
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abc', 'abd')).toBe(false)
    expect(tokenMatches(null, 'abc')).toBe(false)
    expect(tokenMatches('abc', undefined)).toBe(false)
  })
})

describe('audit summaries', () => {
  it('shows before → after for updates', () => {
    expect(summarizeChanges('update', { price: [20, 24], is_available: [true, false] })).toEqual([
      { field: 'price', from: '20', to: '24' },
      { field: 'is_available', from: 'true', to: 'false' },
    ])
  })

  it('leads inserts and deletes with what identifies the row, without noise', () => {
    const lines = summarizeChanges('insert', { id: 'x', tenant_id: 't', description: 'Juicy', name: 'Burger', price: 20 })
    expect(lines.map(l => l.field)).toEqual(['name', 'price', 'description'])
    expect(summarizeChanges('delete', { name: 'n'.repeat(200) })[0].to).toHaveLength(80)
  })
})
