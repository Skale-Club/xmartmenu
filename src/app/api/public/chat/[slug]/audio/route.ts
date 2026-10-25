/**
 * POST /api/public/chat/[slug]/audio
 *
 * Transcribes a voice clip to text through OpenRouter (Whisper or Deepgram,
 * per the tenant's chat_addon_settings.audio_provider). The audio is NOT
 * persisted — only the transcript returns to the client, which sends it as a
 * normal text message. Clips are capped at MAX_VOICE_SECONDS in the widget.
 *
 * Body: multipart/form-data { audio: Blob, conversation_id: string }
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { decryptApiKey, voiceTokenSecret } from '@/lib/crypto'
import { signVoiceTranscript } from '@/lib/chat-channels'
import { MAX_USER_MESSAGE_CHARS } from '@/lib/chat-agent'
import { getChatAddonStatus } from '@/lib/chat-addon'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { transcribeWithOpenRouter, transcriptionModelId, OpenRouterError } from '@/lib/ai/openrouter'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

export const runtime = 'nodejs'
export const maxDuration = 30

// A 60 s voice note is well under 2 MB in any browser codec; this only stops abuse.
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

async function handlePOST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const rl = await rateLimit('chat-audio', getClientIp(request), 8, '5 m')
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const form = await request.formData()
  const audio = form.get('audio')
  const conversationId = form.get('conversation_id')

  if (!(audio instanceof Blob) || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'audio and conversation_id are required' }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Audio too large (max 5 MB)' }, { status: 413 })
  }

  const supabase = createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const status = await getChatAddonStatus(tenant.id)
  if (!status.enabled) return NextResponse.json({ error: 'Chat addon not enabled' }, { status: 403 })

  const { data: convo } = await supabase
    .from('chat_conversations')
    .select('id, tenant_id, status')
    .eq('id', conversationId)
    .maybeSingle()
  if (!convo || convo.tenant_id !== tenant.id || convo.status === 'blocked') {
    return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 })
  }

  // Voice notes are transcribed through OpenRouter on the tenant's own key,
  // the same one the assistant uses; audio_provider picks Whisper or Deepgram.
  const { data: settings } = await supabase
    .from('chat_addon_settings')
    .select('audio_enabled, audio_provider, openrouter_api_key')
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!settings?.audio_enabled || !settings.openrouter_api_key) {
    return NextResponse.json({ error: 'Audio not configured' }, { status: 503 })
  }

  let openRouterKey: string
  try { openRouterKey = decryptApiKey(settings.openrouter_api_key) }
  catch { return NextResponse.json({ error: 'Server config error' }, { status: 500 }) }

  try {
    const transcript = await transcribeWithOpenRouter({
      apiKey: openRouterKey,
      model: transcriptionModelId(settings.audio_provider),
      audio,
    })
    // Capped like a typed message, then signed so the chat route accepts it
    // even when the restaurant switched typed messages off.
    const text = transcript.trim().slice(0, MAX_USER_MESSAGE_CHARS)
    return NextResponse.json({ transcript: text, voice_token: text ? signVoiceTranscript(voiceTokenSecret(), conversationId, text) : null })
  } catch (e) {
    log.error('audio.transcribe_error', { err: e })
    if (e instanceof OpenRouterError) return NextResponse.json({ error: 'Transcription service unavailable' }, { status: 502 })
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}

export const POST = withApi('POST /api/public/chat/[slug]/audio', handlePOST)
