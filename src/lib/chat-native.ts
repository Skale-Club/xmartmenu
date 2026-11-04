import { NextResponse } from 'next/server'
import { resolveAiAccess, runAi } from './ai/access'
import { openRouterModel, OpenRouterError, transcribeWithOpenRouter, transcriptionModelId } from './ai/openrouter'
import { assistantTurnForHistory, buildModelMessages, MAX_USER_MESSAGE_CHARS, runChatAgent } from './chat-agent'
import { hasAnyChannel, resolveChatChannels, signVoiceTranscript, verifyVoiceTranscript } from './chat-channels'
import { buildPublicChatPrompt, type PublicChatBody } from './chat-prompt'
import { voiceTokenSecret } from './crypto'
import { AdminMenuError } from './data/admin-menus'
import { ChatLimitError } from './data/public-chat-turns'
import { readOwnedPublicChatAudio, readOwnedPublicChatTurn, saveOwnedPublicChatTurn } from './data/public-chat-turns-runtime'
import { log } from './observability/log'

function rejected(error: unknown) {
  const body = error instanceof ChatLimitError ? { error: error.message, limit: error.limit, used: error.used }
    : { error: error instanceof AdminMenuError ? error.message : 'Assistant temporarily unavailable' }
  return NextResponse.json(body, { status: error instanceof AdminMenuError ? error.status : 503 })
}

/** No source client; provider work starts only after the read transaction ends. */
export async function handleOwnedChatMessage(slug: string, conversationId: string, userMessage: string, body: PublicChatBody | null) {
  try {
    const context = await readOwnedPublicChatTurn(slug, conversationId, typeof body?.menu_id === 'string' ? body.menu_id : null)
    const access = await resolveAiAccess(context.tenant.id, 'chat')
    if (!access) throw new AdminMenuError(503, 'AI assistant not configured')
    const channels = resolveChatChannels(context.configuration)
    if (!hasAnyChannel(channels)) throw new AdminMenuError(403, 'Chat is turned off')
    let voiceVerified = false
    if (channels.voice && body?.voice_token) {
      try { voiceVerified = verifyVoiceTranscript(voiceTokenSecret(), conversationId, userMessage, body.voice_token) }
      catch (error) { log.error('chat.voice_token_error', { err: error }) }
    }
    if (!channels.text && !voiceVerified) throw new AdminMenuError(403, 'This restaurant takes voice messages only')
    if (context.used >= context.limit) throw new ChatLimitError(context.limit, context.used)
    const system = buildPublicChatPrompt({ tenantName: context.tenant.name, ...context, body })
    let result
    try {
      const modelId = context.configuration.openrouter_model || 'openai/gpt-4o-mini'
      result = await runAi(access, choice => runChatAgent({ model: openRouterModel(choice.apiKey, modelId, access.fetchFor(choice, modelId)), system,
        messages: buildModelMessages([...context.history].reverse(), userMessage), catalog: context.catalog, ordersEnabled: context.canAddToCart }))
    } catch (error) {
      log.error('chat.generate_error', { err: error })
      return NextResponse.json({ error: 'Assistant temporarily unavailable' }, { status: 502 })
    }
    const persisted = await saveOwnedPublicChatTurn({ slug, tenantId: context.tenant.id, conversationId, user: userMessage,
      assistant: assistantTurnForHistory(result.text, result.cartItems), tokens: result.totalTokens, voiceVerified })
    return NextResponse.json({ text: result.text, cart_items: result.cartItems, remaining_today: persisted.remaining_today })
  } catch (error) { return rejected(error) }
}

export async function handleOwnedChatAudio(slug: string, conversationId: string, audio: Blob) {
  try {
    const context = await readOwnedPublicChatAudio(slug, conversationId)
    const access = await resolveAiAccess(context.tenant.id, 'transcription')
    if (!access) throw new AdminMenuError(503, 'Audio not configured')
    try {
      const model = transcriptionModelId(context.configuration.audio_provider)
      const transcript = await runAi(access, choice => transcribeWithOpenRouter({ apiKey: choice.apiKey, model, audio, fetchImpl: access.fetchFor(choice, model) }))
      const text = transcript.trim().slice(0, MAX_USER_MESSAGE_CHARS)
      return NextResponse.json({ transcript: text, voice_token: text ? signVoiceTranscript(voiceTokenSecret(), conversationId, text) : null })
    } catch (error) {
      log.error('audio.transcribe_error', { err: error })
      return NextResponse.json({ error: error instanceof OpenRouterError ? 'Transcription service unavailable' : 'Transcription failed' }, { status: error instanceof OpenRouterError ? 502 : 500 })
    }
  } catch (error) { return rejected(error) }
}
