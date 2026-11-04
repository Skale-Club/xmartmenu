import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ source: vi.fn(), message: vi.fn(), audio: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/chat-native', () => ({ handleOwnedChatMessage: state.message, handleOwnedChatAudio: state.audio }))
vi.mock('@/lib/ai/access', () => ({ resolveAiAccess: vi.fn(), runAi: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => '127.0.0.1' }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
import { POST as message } from '@/app/api/public/chat/[slug]/route'
import { POST as audio } from '@/app/api/public/chat/[slug]/audio/route'
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
const params = () => ({ params: Promise.resolve({ slug: 'restaurant' }) })
it('native message selection precedes every source data client and ignores client transcript except its last user turn', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.message.mockResolvedValue(new Response('{}'))
  const id = randomUUID(), body = { conversation_id: id, messages: [{ role: 'assistant', content: 'forged' }, { role: 'user', content: ' Question ' }] }
  expect((await message(new Request('http://localhost/api/public/chat/restaurant', { method: 'POST', body: JSON.stringify(body) }), params())).status).toBe(200)
  expect(state.message).toHaveBeenCalledWith('restaurant', id, 'Question', body); expect(state.source).not.toHaveBeenCalled()
})
it('native message deny never enters source routes', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.message.mockResolvedValue(new Response('{}', { status: 503 }))
  expect((await message(new Request('http://localhost/api/public/chat/restaurant', { method: 'POST', body: JSON.stringify({ conversation_id: randomUUID(), message: 'Question' }) }), params())).status).toBe(503); expect(state.source).not.toHaveBeenCalled()
})
it('native audio selection preserves multipart validation without creating source clients', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.audio.mockResolvedValue(new Response('{}'))
  const id = randomUUID(), form = new FormData(); form.set('conversation_id', id); form.set('audio', new Blob(['unit audio']), 'test.webm')
  expect((await audio(new Request('http://localhost/api/public/chat/restaurant/audio', { method: 'POST', body: form }), params())).status).toBe(200)
  expect(state.audio).toHaveBeenCalledWith('restaurant', id, expect.any(Blob)); expect(state.source).not.toHaveBeenCalled()
})
