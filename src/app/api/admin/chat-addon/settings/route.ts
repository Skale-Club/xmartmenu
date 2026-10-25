/**
 * Admin chat-addon settings API.
 * GET  — returns the chat settings (never the key columns)
 * PUT  — upserts them. The OpenRouter key is not set here any more: it lives
 *        in tenant_ai_settings (Settings › AI & billing, /api/admin/ai).
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { getChatAddonStatus } from '@/lib/chat-addon'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

async function handleGET() {
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

  return NextResponse.json({
    settings: data
      ? {
          ...data,
          // Legacy key columns: keys live in tenant_ai_settings now.
          openrouter_api_key: undefined,
          audio_api_key: undefined,
        }
      : null,
    status,
  })
}

async function handlePUT(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    enabled,
    openrouter_model,
    audio_enabled,
    text_enabled,
    audio_provider,
    rate_limit_per_phone_per_day,
  } = body as Record<string, any>

  const supabase = createServiceClient()
  const payload: Record<string, unknown> = { tenant_id: effective.tenantId, updated_at: new Date().toISOString() }
  if (typeof enabled === 'boolean') payload.enabled = enabled
  if (typeof openrouter_model === 'string') payload.openrouter_model = openrouter_model
  if (typeof audio_enabled === 'boolean') payload.audio_enabled = audio_enabled
  if (typeof text_enabled === 'boolean') payload.text_enabled = text_enabled
  if (audio_provider === null || audio_provider === 'whisper' || audio_provider === 'deepgram') {
    payload.audio_provider = audio_provider
  }
  if (typeof rate_limit_per_phone_per_day === 'number') {
    payload.rate_limit_per_phone_per_day = Math.max(1, Math.min(500, Math.floor(rate_limit_per_phone_per_day)))
  }

  const { error } = await supabase
    .from('chat_addon_settings')
    .upsert(payload, { onConflict: 'tenant_id' })

  if (error) {
    log.error('chat_addon_settings.upsert_error', { err: error })
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export const GET = withApi('GET /api/admin/chat-addon/settings', handleGET)
export const PUT = withApi('PUT /api/admin/chat-addon/settings', handlePUT)
