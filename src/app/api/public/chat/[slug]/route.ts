/**
 * Public AI chat endpoint.
 *
 * - Validates conversation_id belongs to the tenant
 * - Enforces rate limit (rate_limit_per_phone_per_day) and blocklist
 * - Decrypts the tenant's OpenRouter API key
 * - Rebuilds the conversation from chat_messages (the client sends only the new
 *   message; its copy of the history is never trusted)
 * - Runs the assistant (chat-agent.ts) and persists user + assistant turns
 *
 * addToCart is validated and priced on the server against the same catalog the
 * prompt describes; the response carries ready-to-add cart items (options,
 * editor state, trusted unit price) that the widget applies to the in-memory
 * cart. Checkout re-prices them from the editor state anyway.
 */
import { NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { createServiceClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'
import { countMessagesLast24h, getChatAddonStatus } from '@/lib/chat-addon'
import {
  HISTORY_LIMIT,
  MAX_USER_MESSAGE_CHARS,
  assistantTurnForHistory,
  buildModelMessages,
  buildSystemPrompt,
  formatMenuContext,
  loadMenuCatalog,
  runChatAgent,
} from '@/lib/chat-agent'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ChatRequestBody {
  conversation_id: string
  message?: string
  // Older widget builds still post the whole transcript; only its last user
  // turn is read.
  messages?: Array<{ role: string; content: string }>
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const ip = getClientIp(request)
  const rl = await rateLimit('chat-message', ip, 20, '1 m')
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  // The per-phone daily cap below is keyed on an UNVERIFIED, attacker-chosen
  // phone (no OTP), so rotating fake numbers resets it and burns the tenant's
  // paid OpenRouter credits. Bound total spend per device with an IP daily cap
  // that phone rotation can't bypass. (Full protection needs phone verification.)
  const rlDay = await rateLimit('chat-message-ip-day', ip, 300, '1 d')
  if (!rlDay.ok) return NextResponse.json({ error: 'Daily limit reached for this device.' }, { status: 429 })

  const body = (await request.json().catch(() => null)) as ChatRequestBody | null
  const conversation_id = body?.conversation_id
  const rawMessage = typeof body?.message === 'string'
    ? body.message
    : [...(Array.isArray(body?.messages) ? body.messages : [])].reverse().find((m) => m?.role === 'user')?.content
  const userMessage = typeof rawMessage === 'string' ? rawMessage.trim() : ''

  if (!conversation_id || !userMessage) {
    return NextResponse.json({ error: 'conversation_id and message are required' }, { status: 400 })
  }
  if (userMessage.length > MAX_USER_MESSAGE_CHARS) {
    return NextResponse.json({ error: `Message too long (max ${MAX_USER_MESSAGE_CHARS} characters)` }, { status: 413 })
  }

  const supabase = createServiceClient()

  // Resolve tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, tenant_settings(orders_enabled, address, phone, business_hours, business_type, currency)')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Addon status
  const status = await getChatAddonStatus(tenant.id)
  if (!status.enabled) return NextResponse.json({ error: 'Chat addon not enabled' }, { status: 403 })

  // Validate conversation
  const { data: convo } = await supabase
    .from('chat_conversations')
    .select('id, tenant_id, phone_hash, status, message_count')
    .eq('id', conversation_id)
    .maybeSingle()
  if (!convo || convo.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 })
  }
  if (convo.status === 'blocked') {
    return NextResponse.json({ error: 'Conversation has been blocked' }, { status: 403 })
  }

  // Blocklist check
  const { data: blocked } = await supabase
    .from('chat_blocked_phones')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('phone_hash', convo.phone_hash)
    .maybeSingle()
  if (blocked) return NextResponse.json({ error: 'This number is blocked' }, { status: 403 })

  // Addon settings (model + decrypted key)
  const { data: settings } = await supabase
    .from('chat_addon_settings')
    .select('openrouter_api_key, openrouter_model, rate_limit_per_phone_per_day')
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!settings?.openrouter_api_key) {
    return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 503 })
  }

  // Rate limit
  const limit = settings.rate_limit_per_phone_per_day ?? 30
  const used = await countMessagesLast24h(supabase, tenant.id, convo.phone_hash)
  if (used >= limit) {
    return NextResponse.json({ error: 'Daily message limit reached', limit, used }, { status: 429 })
  }

  let openRouterKey: string
  try {
    openRouterKey = decryptApiKey(settings.openrouter_api_key)
  } catch (e) {
    console.error('chat.decrypt_error', e)
    return NextResponse.json({ error: 'Server config error' }, { status: 500 })
  }

  const settingsRow = (tenant.tenant_settings as any) ?? {}
  const ordersEnabled: boolean = !!settingsRow.orders_enabled

  const [catalog, { data: history }] = await Promise.all([
    loadMenuCatalog(supabase, tenant.id, settingsRow.currency ?? null),
    supabase
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
  ])

  const systemPrompt = buildSystemPrompt(
    {
      name: tenant.name,
      address: settingsRow.address,
      phone: settingsRow.phone,
      hours: settingsRow.business_hours,
      cuisine: settingsRow.business_type,
    },
    formatMenuContext(catalog),
    ordersEnabled,
  )

  // OpenRouter is OpenAI-compatible — point @ai-sdk/openai at it
  const openrouter = createOpenAI({
    apiKey: openRouterKey,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  let result
  try {
    result = await runChatAgent({
      model: openrouter(settings.openrouter_model || 'openai/gpt-4o-mini'),
      system: systemPrompt,
      messages: buildModelMessages([...(history ?? [])].reverse(), userMessage),
      catalog,
      ordersEnabled,
    })
  } catch (e) {
    console.error('chat.generate_error', e)
    return NextResponse.json({ error: 'Assistant temporarily unavailable' }, { status: 502 })
  }

  // Persist user + assistant turns; bump conversation aggregates. Distinct
  // timestamps keep the pair in order when the history is read back.
  const now = Date.now()
  await supabase.from('chat_messages').insert([
    {
      conversation_id: convo.id,
      role: 'user',
      content: userMessage,
      created_at: new Date(now).toISOString(),
    },
    {
      conversation_id: convo.id,
      role: 'assistant',
      content: assistantTurnForHistory(result.text, result.cartItems),
      created_at: new Date(now + 1).toISOString(),
      tokens_used: result.totalTokens,
    },
  ])
  await supabase
    .from('chat_conversations')
    .update({
      last_message_at: new Date(now + 1).toISOString(),
      message_count: (convo.message_count ?? 0) + 2,
    })
    .eq('id', convo.id)

  return NextResponse.json({
    text: result.text,
    cart_items: result.cartItems,
    remaining_today: Math.max(0, limit - used - 1),
  })
}
