/**
 * Admin chat-addon settings API.
 * GET  — returns settings with API keys masked
 * PUT  — upserts settings; encrypts keys before persisting; preserves
 *        existing ciphertext when the client sends back the masked value.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { encryptApiKey, maskApiKey, decryptApiKey } from '@/lib/crypto'
import { getChatAddonStatus } from '@/lib/chat-addon'

function isMaskedValue(v: string | null | undefined) {
  return typeof v === 'string' && v.includes('••')
}

export async function GET() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('chat_addon_settings')
    .select('*')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  const status = await getChatAddonStatus(effective.tenantId)

  // Mask keys before returning
  const openrouter_masked = data?.openrouter_api_key
    ? (() => { try { return maskApiKey(decryptApiKey(data.openrouter_api_key)) } catch { return '••••' } })()
    : ''
  const audio_masked = data?.audio_api_key
    ? (() => { try { return maskApiKey(decryptApiKey(data.audio_api_key)) } catch { return '••••' } })()
    : ''

  return NextResponse.json({
    settings: data
      ? {
          ...data,
          openrouter_api_key: openrouter_masked,
          audio_api_key: audio_masked,
        }
      : null,
    status,
  })
}

export async function PUT(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    enabled,
    openrouter_api_key,
    openrouter_model,
    audio_enabled,
    audio_provider,
    audio_api_key,
    rate_limit_per_phone_per_day,
  } = body as Record<string, any>

  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('chat_addon_settings')
    .select('openrouter_api_key, audio_api_key')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  // Only re-encrypt keys when the client sent a new plaintext value.
  // Masked values mean "keep existing ciphertext".
  let nextOpenrouterKey: string | null | undefined = undefined
  if (typeof openrouter_api_key === 'string') {
    if (openrouter_api_key === '') nextOpenrouterKey = null
    else if (isMaskedValue(openrouter_api_key)) nextOpenrouterKey = existing?.openrouter_api_key ?? null
    else nextOpenrouterKey = encryptApiKey(openrouter_api_key)
  }
  let nextAudioKey: string | null | undefined = undefined
  if (typeof audio_api_key === 'string') {
    if (audio_api_key === '') nextAudioKey = null
    else if (isMaskedValue(audio_api_key)) nextAudioKey = existing?.audio_api_key ?? null
    else nextAudioKey = encryptApiKey(audio_api_key)
  }

  const payload: Record<string, unknown> = { tenant_id: effective.tenantId, updated_at: new Date().toISOString() }
  if (typeof enabled === 'boolean') payload.enabled = enabled
  if (typeof openrouter_model === 'string') payload.openrouter_model = openrouter_model
  if (typeof audio_enabled === 'boolean') payload.audio_enabled = audio_enabled
  if (audio_provider === null || audio_provider === 'whisper' || audio_provider === 'deepgram') {
    payload.audio_provider = audio_provider
  }
  if (typeof rate_limit_per_phone_per_day === 'number') {
    payload.rate_limit_per_phone_per_day = Math.max(1, Math.min(500, Math.floor(rate_limit_per_phone_per_day)))
  }
  if (nextOpenrouterKey !== undefined) payload.openrouter_api_key = nextOpenrouterKey
  if (nextAudioKey !== undefined) payload.audio_api_key = nextAudioKey

  const { error } = await supabase
    .from('chat_addon_settings')
    .upsert(payload, { onConflict: 'tenant_id' })

  if (error) {
    console.error('chat_addon_settings.upsert_error', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
