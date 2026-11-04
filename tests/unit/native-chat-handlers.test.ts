import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { signVoiceTranscript, verifyVoiceTranscript } from '@/lib/chat-channels'
import { voiceTokenSecret } from '@/lib/crypto'
import { resolveTenantCapabilities } from '@/lib/service-modes'
const state = vi.hoisted(() => ({ read: vi.fn(), audio: vi.fn(), save: vi.fn(), access: vi.fn(), run: vi.fn(), agent: vi.fn(), transcribe: vi.fn(), model: vi.fn() }))
vi.mock('@/lib/data/public-chat-turns-runtime', () => ({ readOwnedPublicChatTurn: state.read, readOwnedPublicChatAudio: state.audio, saveOwnedPublicChatTurn: state.save }))
vi.mock('@/lib/ai/access', () => ({ resolveAiAccess: state.access, runAi: state.run }))
vi.mock('@/lib/ai/openrouter', () => ({ openRouterModel: state.model, transcribeWithOpenRouter: state.transcribe, transcriptionModelId: () => 'test/transcription', OpenRouterError: class extends Error {} }))
vi.mock('@/lib/chat-agent', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/chat-agent')>(), runChatAgent: state.agent }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
import { handleOwnedChatAudio, handleOwnedChatMessage } from '@/lib/chat-native'
const tenantId = randomUUID(), conversationId = randomUUID()
const context = () => ({ tenant: { id: tenantId, name: 'Restaurant' }, conversation: { id: conversationId }, configuration: { text_enabled: true, audio_enabled: true, audio_provider: 'whisper', openrouter_model: 'test/model' }, limit: 20, used: 3,
  settingsRow: { currency: 'USD', country: 'US' }, capabilities: resolveTenantCapabilities([], null), canAddToCart: false, catalog: null, history: [{ role: 'assistant', content: 'Previous answer' }, { role: 'user', content: 'Previous question' }], locations: [], zones: [], onlinePayment: false })
beforeEach(() => {
  vi.stubEnv('CHAT_ADDON_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
  state.read.mockResolvedValue(context()); state.audio.mockResolvedValue(context()); state.save.mockResolvedValue({ remaining_today: 16 })
  state.access.mockResolvedValue({ primary: { apiKey: randomUUID() }, fetchFor: () => vi.fn() })
  state.run.mockImplementation(async (access, callback) => callback(access.primary)); state.agent.mockResolvedValue({ text: 'Answer', cartItems: [], totalTokens: 12 }); state.transcribe.mockResolvedValue('  Voice message  ')
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
it('finishes the read transaction before provider work and persists both trusted turns before acknowledging', async () => {
  const order: string[] = []
  state.read.mockImplementation(async () => { order.push('read'); return context() }); state.agent.mockImplementation(async () => { order.push('provider'); return { text: 'Answer', cartItems: [], totalTokens: 12 } }); state.save.mockImplementation(async () => { order.push('persist'); return { remaining_today: 16 } })
  const response = await handleOwnedChatMessage('restaurant', conversationId, 'Question', { menu_id: 'requested' })
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ text: 'Answer', cart_items: [], remaining_today: 16 }); expect(order).toEqual(['read', 'provider', 'persist'])
  expect(state.agent.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'Previous question' }, { role: 'assistant', content: 'Previous answer' }, { role: 'user', content: 'Question' }])
  expect(state.save).toHaveBeenCalledWith({ slug: 'restaurant', tenantId, conversationId, user: 'Question', assistant: 'Answer', tokens: 12, voiceVerified: false })
})
it('denies unavailable/blocked admission and current quota before provider work', async () => {
  state.read.mockRejectedValueOnce(new AdminMenuError(403, 'This number is blocked'))
  expect((await handleOwnedChatMessage('restaurant', conversationId, 'Question', {})).status).toBe(403)
  state.read.mockResolvedValueOnce({ ...context(), used: 20 })
  const limited = await handleOwnedChatMessage('restaurant', conversationId, 'Question', {})
  expect(limited.status).toBe(429); expect(await limited.json()).toEqual({ error: 'Daily message limit reached', limit: 20, used: 20 }); expect(state.agent).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled()
})
it('voice-only mode requires a current conversation-bound signed transcript', async () => {
  const voice = { ...context(), configuration: { ...context().configuration, text_enabled: false } }; state.read.mockResolvedValue(voice)
  expect((await handleOwnedChatMessage('restaurant', conversationId, 'Question', {})).status).toBe(403)
  expect((await handleOwnedChatMessage('restaurant', conversationId, 'Question', { voice_token: signVoiceTranscript(voiceTokenSecret(), randomUUID(), 'Question') })).status).toBe(403)
  const response = await handleOwnedChatMessage('restaurant', conversationId, 'Question', { voice_token: signVoiceTranscript(voiceTokenSecret(), conversationId, 'Question') })
  expect(response.status).toBe(200); expect(state.save.mock.calls[0][0].voiceVerified).toBe(true)
})
it('provider errors do not persist invented turns; persistence errors never return a successful answer', async () => {
  state.agent.mockRejectedValueOnce(new Error('Mock provider failure'))
  expect((await handleOwnedChatMessage('restaurant', conversationId, 'Question', {})).status).toBe(502); expect(state.save).not.toHaveBeenCalled()
  state.save.mockRejectedValueOnce(new AdminMenuError(503, 'Unavailable'))
  expect((await handleOwnedChatMessage('restaurant', conversationId, 'Question', {})).status).toBe(503)
})
it('audio returns the existing trimmed, conversation-bound signed transcript after native admission', async () => {
  const response = await handleOwnedChatAudio('restaurant', conversationId, new Blob(['unit audio'])), body = await response.json()
  expect(response.status).toBe(200); expect(body.transcript).toBe('Voice message')
  expect(verifyVoiceTranscript(voiceTokenSecret(), conversationId, body.transcript, body.voice_token)).toBe(true)
  expect(verifyVoiceTranscript(voiceTokenSecret(), randomUUID(), body.transcript, body.voice_token)).toBe(false)
})
it('audio native admission failure consumes no transcription provider call', async () => {
  state.audio.mockRejectedValue(new AdminMenuError(403, 'This number is blocked'))
  expect((await handleOwnedChatAudio('restaurant', conversationId, new Blob(['unit audio']))).status).toBe(403); expect(state.transcribe).not.toHaveBeenCalled()
})
