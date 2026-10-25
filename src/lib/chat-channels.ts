/**
 * How guests may talk to a restaurant's AI assistant: typed messages, voice
 * notes, or both. Each restaurant switches them in Settings › Chat
 * (chat_addon_settings.text_enabled / audio_enabled).
 *
 * With typed messages off, the chat route only accepts text that our own
 * transcription produced: the audio route signs each transcript for its
 * conversation, and the chat route checks the signature. Hiding the text box
 * alone would not stop a script from posting text.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export interface ChatChannels {
  text: boolean
  voice: boolean
}

/** Typed messages default to on (existing assistants); voice notes to off. */
export function resolveChatChannels(settings: { text_enabled?: boolean | null; audio_enabled?: boolean | null } | null | undefined): ChatChannels {
  return { text: settings?.text_enabled ?? true, voice: settings?.audio_enabled ?? false }
}

export function hasAnyChannel(channels: ChatChannels): boolean {
  return channels.text || channels.voice
}

/** How long a transcript may wait between transcription and sending. */
export const VOICE_TOKEN_TTL_MS = 10 * 60 * 1000

function signature(secret: Buffer | string, conversationId: string, transcript: string, issuedAt: number): string {
  return createHmac('sha256', secret)
    .update(`voice-transcript\n${conversationId}\n${issuedAt}\n${transcript}`)
    .digest('base64url')
}

/** A token proving `transcript` came from our transcription for this conversation. */
export function signVoiceTranscript(secret: Buffer | string, conversationId: string, transcript: string, now = Date.now()): string {
  return `${now}.${signature(secret, conversationId, transcript, now)}`
}

export function verifyVoiceTranscript(
  secret: Buffer | string,
  conversationId: string,
  transcript: string,
  token: unknown,
  now = Date.now(),
): boolean {
  if (typeof token !== 'string') return false
  const [issued, sig] = token.split('.')
  const issuedAt = Number(issued)
  if (!sig || !Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > VOICE_TOKEN_TTL_MS) return false
  const expected = Buffer.from(signature(secret, conversationId, transcript, issuedAt))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
