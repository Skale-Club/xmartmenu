import { describe, expect, it } from 'vitest'
import {
  VOICE_TOKEN_TTL_MS,
  hasAnyChannel,
  resolveChatChannels,
  signVoiceTranscript,
  verifyVoiceTranscript,
} from '@/lib/chat-channels'

describe('resolveChatChannels', () => {
  it('keeps typed messages on and voice off for assistants set up before the switch', () => {
    expect(resolveChatChannels(null)).toEqual({ text: true, voice: false })
    expect(resolveChatChannels({ audio_enabled: true })).toEqual({ text: true, voice: true })
  })

  it('follows each restaurant choice', () => {
    expect(resolveChatChannels({ text_enabled: false, audio_enabled: true })).toEqual({ text: false, voice: true })
    expect(resolveChatChannels({ text_enabled: true, audio_enabled: false })).toEqual({ text: true, voice: false })
    expect(hasAnyChannel(resolveChatChannels({ text_enabled: false, audio_enabled: false }))).toBe(false)
    expect(hasAnyChannel({ text: false, voice: true })).toBe(true)
  })
})

describe('voice transcript tokens', () => {
  const secret = Buffer.alloc(32, 7)
  const now = 1_760_000_000_000

  it('accepts the exact transcript for its conversation', () => {
    const token = signVoiceTranscript(secret, 'conv-1', 'Two margheritas, please', now)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Two margheritas, please', token, now + 5_000)).toBe(true)
  })

  it('rejects edited text, another conversation, another secret or a missing token', () => {
    const token = signVoiceTranscript(secret, 'conv-1', 'Two margheritas', now)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Ten margheritas', token, now)).toBe(false)
    expect(verifyVoiceTranscript(secret, 'conv-2', 'Two margheritas', token, now)).toBe(false)
    expect(verifyVoiceTranscript(Buffer.alloc(32, 8), 'conv-1', 'Two margheritas', token, now)).toBe(false)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Two margheritas', undefined, now)).toBe(false)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Two margheritas', 'garbage', now)).toBe(false)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Two margheritas', `${now}.`, now)).toBe(false)
  })

  it('expires', () => {
    const token = signVoiceTranscript(secret, 'conv-1', 'Hi', now)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Hi', token, now + VOICE_TOKEN_TTL_MS - 1)).toBe(true)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Hi', token, now + VOICE_TOKEN_TTL_MS + 1)).toBe(false)
    const future = signVoiceTranscript(secret, 'conv-1', 'Hi', now + 5 * 60_000)
    expect(verifyVoiceTranscript(secret, 'conv-1', 'Hi', future, now)).toBe(false)
  })
})
