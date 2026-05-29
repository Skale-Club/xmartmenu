/**
 * POST /api/public/chat/[slug]/audio
 *
 * Transcribes a voice clip to text via Whisper or Deepgram, depending on the
 * tenant's chat_addon_settings. The audio is NOT persisted — only the transcript
 * returns to the client, who can then send it as a normal text message.
 *
 * Body: multipart/form-data { audio: Blob, conversation_id: string }
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'
import { getChatAddonStatus } from '@/lib/chat-addon'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
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
    return NextResponse.json({ error: 'Audio too large (max 10 MB)' }, { status: 413 })
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

  const { data: settings } = await supabase
    .from('chat_addon_settings')
    .select('audio_enabled, audio_provider, audio_api_key')
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!settings?.audio_enabled || !settings.audio_provider || !settings.audio_api_key) {
    return NextResponse.json({ error: 'Audio not configured' }, { status: 503 })
  }

  let audioKey: string
  try { audioKey = decryptApiKey(settings.audio_api_key) }
  catch { return NextResponse.json({ error: 'Server config error' }, { status: 500 }) }

  try {
    if (settings.audio_provider === 'whisper') {
      // OpenAI Whisper — multipart/form-data
      const oaForm = new FormData()
      oaForm.append('file', audio, 'voice.webm')
      oaForm.append('model', 'whisper-1')
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${audioKey}` },
        body: oaForm,
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        return NextResponse.json({ error: `Whisper error: ${t.slice(0, 200)}` }, { status: 502 })
      }
      const data = await res.json() as { text?: string }
      return NextResponse.json({ transcript: data.text ?? '' })
    } else {
      // Deepgram — raw audio body
      const arrayBuf = await audio.arrayBuffer()
      const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&detect_language=true', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${audioKey}`,
          'Content-Type': audio.type || 'audio/webm',
        },
        body: arrayBuf,
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        return NextResponse.json({ error: `Deepgram error: ${t.slice(0, 200)}` }, { status: 502 })
      }
      const data = await res.json() as any
      const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
      return NextResponse.json({ transcript })
    }
  } catch (e) {
    console.error('audio.transcribe_error', e)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
