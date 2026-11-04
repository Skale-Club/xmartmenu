import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createPublicChatSession, readPublicChatAddon } from '@/lib/data/public-chat-session'
import { hashPhone } from '@/lib/crypto'
import { AdminMenuError } from '@/lib/data/admin-menus'

const tenantId = randomUUID(), conversationId = randomUUID(), phone = '+1 (202) 555-0101'
const state = vi.hoisted(() => ({ source: vi.fn(), owned: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/data/public-chat-session-runtime', () => ({ createOwnedPublicChatSession: state.owned }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
import { POST } from '@/app/api/public/chat/[slug]/session/route'
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

const fixture = (existing = false) => vi.fn()
  .mockResolvedValueOnce({ rows: [{ id: tenantId }] })
  .mockResolvedValueOnce({ rows: [{ chat_addon_available: true, chat_addon_active: true, chat_addon_override: null }] })
  .mockResolvedValueOnce({ rows: [{ enabled: true, rate_limit_per_phone_per_day: 20 }] })
  .mockResolvedValueOnce({ rows: [] }) // advisory lock
  .mockResolvedValueOnce({ rows: [] }) // blocklist
  .mockResolvedValueOnce({ rows: existing ? [{ id: conversationId, message_count: 6 }] : [] })
  .mockResolvedValueOnce({ rows: [{ id: conversationId }] })

it('uses only tenant-scoped phone hashes in SQL and applies the exact UTC-day boundary', async () => {
  const query = fixture(), now = new Date('2026-11-04T12:34:56Z')
  expect(await createPublicChatSession(query, 'restaurant', phone, now)).toEqual({ conversation_id: conversationId, rate_limit: 20, messages_today: 0 })
  const hashed = hashPhone('12025550101', tenantId)
  expect(query.mock.calls[4][1]).toEqual([tenantId, hashed])
  expect(query.mock.calls[5][1]).toEqual([tenantId, hashed, '2026-11-04T00:00:00.000Z'])
  expect(query.mock.calls[6][1]).toEqual([tenantId, hashed])
  expect(JSON.stringify(query.mock.calls)).not.toContain('12025550101')
})
it('reuses the latest conversation and preserves its message-count acknowledgement', async () => {
  const query = fixture(true)
  expect(await createPublicChatSession(query, 'restaurant', phone)).toEqual({ conversation_id: conversationId, rate_limit: 20, messages_today: 6 })
  expect(query).toHaveBeenCalledTimes(6)
})
it('preserves plan/addon force-on, force-off and settings combinations', async () => {
  for (const [available, active, override, enabled, expected] of [
    [true, true, null, true, true], [true, true, false, true, false], [false, false, true, true, true],
    [true, false, null, true, false], [true, true, null, false, false],
  ] as const) {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ chat_addon_available: available, chat_addon_active: active, chat_addon_override: override }] }).mockResolvedValueOnce({ rows: [{ enabled }] })
    const result = await readPublicChatAddon(query, tenantId)
    expect(result.status.enabled).toBe(expected); expect(result.status.overrideApplied).toBe(override !== null); expect(result.rateLimit).toBe(30)
  }
})
it('rejects invalid phones before any SQL and blocked hashes before conversation reads', async () => {
  const query = vi.fn()
  await expect(createPublicChatSession(query, 'restaurant', 1234)).rejects.toMatchObject({ status: 400 }); expect(query).not.toHaveBeenCalled()
  const blocked = fixture(); blocked.mockReset().mockResolvedValueOnce({ rows: [{ id: tenantId }] }).mockResolvedValueOnce({ rows: [{ chat_addon_available: true, chat_addon_active: true }] }).mockResolvedValueOnce({ rows: [{ enabled: true }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: randomUUID() }] })
  await expect(createPublicChatSession(blocked, 'restaurant', phone)).rejects.toMatchObject({ status: 403 }); expect(blocked).toHaveBeenCalledTimes(5)
})
const request = () => new Request('http://localhost/api/public/chat/restaurant/session', { method: 'POST', body: JSON.stringify({ phone }) })
const context = () => ({ params: Promise.resolve({ slug: 'restaurant' }) })
it('selects native conversation creation without constructing a source Auth/data client', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.owned.mockResolvedValue({ conversation_id: conversationId, rate_limit: 20, messages_today: 0 })
  expect((await POST(request(), context())).status).toBe(200); expect(state.owned).toHaveBeenCalledWith('restaurant', phone); expect(state.source).not.toHaveBeenCalled()
})
it('native deny/unavailable responses never switch back to source', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
  for (const status of [403, 503]) { state.owned.mockRejectedValue(new AdminMenuError(status, 'Unavailable')); expect((await POST(request(), context())).status).toBe(status) }
  expect(state.source).not.toHaveBeenCalled()
})
