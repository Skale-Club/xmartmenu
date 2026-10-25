/**
 * Public AI chat endpoint.
 *
 * - Validates conversation_id belongs to the tenant
 * - Enforces rate limit (rate_limit_per_phone_per_day) and blocklist
 * - Decrypts the tenant's OpenRouter API key
 * - Rebuilds the conversation from chat_messages (the client sends only the new
 *   message; its copy of the history is never trusted)
 * - Describes the restaurant (or the location being viewed), its hours and
 *   open/closed status, and how ordering works there (chat-context.ts)
 * - Runs the assistant (chat-agent.ts) on the menu the customer is viewing,
 *   and persists user + assistant turns
 *
 * addToCart is validated and priced on the server against the same catalog the
 * prompt describes; the response carries ready-to-add cart items (options,
 * editor state, trusted unit price) that the widget applies to the in-memory
 * cart. Checkout re-prices them from the editor state anyway.
 */
import { NextResponse } from 'next/server'
import { openRouterModel } from '@/lib/ai/openrouter'
import { getTenantServiceCapabilities } from '@/lib/tenant-plan'
import { hasAnyChannel, resolveChatChannels, verifyVoiceTranscript } from '@/lib/chat-channels'
import { createServiceClient } from '@/lib/supabase/server'
import { decryptApiKey, voiceTokenSecret } from '@/lib/crypto'
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
import { computeOpenStatus, describeOrdering, describeProfile, resolveOrderingMode, resolveTimeZone } from '@/lib/chat-context'
import { isStripeEnabled } from '@/lib/stripe'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ChatRequestBody {
  conversation_id: string
  message?: string
  // What the customer is looking at; both are re-checked against the tenant.
  menu_id?: string | null
  location_id?: string | null
  // Older widget builds still post the whole transcript; only its last user
  // turn is read.
  messages?: Array<{ role: string; content: string }>
  // Set when `message` is a voice-note transcript (signed by the audio route).
  voice_token?: string
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
    .select('id, name, tenant_settings(orders_enabled, direct_orders_enabled, whatsapp_orders_enabled, dine_in_enabled, pickup_enabled, pickup_eta_minutes, delivery_enabled, delivery_fee_cents, tips_enabled, currency, address, city, region, postal_code, country, phone, whatsapp, instagram, business_hours, business_type, tagline, about, price_range)')
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
    .select('openrouter_api_key, openrouter_model, rate_limit_per_phone_per_day, text_enabled, audio_enabled')
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!settings?.openrouter_api_key) {
    return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 503 })
  }

  // The restaurant decides how guests may write: typed text, voice notes or both.
  const channels = resolveChatChannels(settings)
  if (!hasAnyChannel(channels)) return NextResponse.json({ error: 'Chat is turned off' }, { status: 403 })
  if (!channels.text) {
    let fromVoice = false
    try {
      fromVoice = channels.voice && verifyVoiceTranscript(voiceTokenSecret(), conversation_id, userMessage, body?.voice_token)
    } catch (e) {
      console.error('chat.voice_token_error', e)
    }
    if (!fromVoice) return NextResponse.json({ error: 'This restaurant takes voice messages only' }, { status: 403 })
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

  const rawSettings = (tenant.tenant_settings as any) ?? {}
  // Same rule as the menu page and checkout: the cart only exists when the plan
  // allows guest orders and the restaurant switched them on (service-modes.ts).
  const serviceCapabilities = await getTenantServiceCapabilities(tenant.id, rawSettings, supabase)
  const settingsRow = { ...rawSettings, direct_orders_enabled: serviceCapabilities.guestOrdering }
  // Same gate as the menu page (cart visible) and checkout (orders accepted).
  const canAddToCart = resolveOrderingMode(settingsRow) === 'cart'
  const menuId = typeof body?.menu_id === 'string' ? body.menu_id : null
  const locationId = typeof body?.location_id === 'string' ? body.location_id : null

  const [catalog, { data: history }, { data: locations }, { data: zones }, onlinePayment] = await Promise.all([
    loadMenuCatalog(supabase, tenant.id, settingsRow.currency ?? null, menuId),
    supabase
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase
      .from('locations')
      .select('id, name, address, city, region, postal_code, country, phone, business_hours')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('name'),
    settingsRow.delivery_enabled
      ? supabase.from('delivery_zones').select('name, fee_cents').eq('tenant_id', tenant.id).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] as Array<{ name: string; fee_cents: number }> }),
    canAddToCart ? isStripeEnabled(tenant.id, supabase).catch(() => false) : Promise.resolve(false),
  ])

  // A location page describes that location: its address, phone and hours
  // win over the restaurant's, falling back field by field.
  const location = locationId ? (locations ?? []).find((l) => l.id === locationId) ?? null : null
  const hours = location?.business_hours && Object.values(location.business_hours).some(Boolean)
    ? location.business_hours
    : settingsRow.business_hours
  const country = location?.country ?? settingsRow.country
  const region = location?.region ?? settingsRow.region
  const timeZone = resolveTimeZone({ country, region, currency: settingsRow.currency })

  const profile = describeProfile(
    {
      name: tenant.name,
      locationName: location?.name ?? null,
      tagline: settingsRow.tagline,
      about: settingsRow.about,
      cuisine: settingsRow.business_type,
      priceRange: settingsRow.price_range,
      address: location?.address ?? settingsRow.address,
      city: location?.city ?? settingsRow.city,
      region,
      postalCode: location?.postal_code ?? settingsRow.postal_code,
      country,
      phone: location?.phone ?? settingsRow.phone,
      whatsapp: settingsRow.whatsapp,
      instagram: settingsRow.instagram,
      hours,
      otherLocations: (locations ?? []).filter((l) => l.id !== location?.id),
    },
    computeOpenStatus(hours, new Date(), timeZone),
  )

  const systemPrompt = buildSystemPrompt({
    name: tenant.name,
    profile,
    menuContext: formatMenuContext(catalog),
    ordering: describeOrdering(settingsRow, { onlinePayment, deliveryZones: zones ?? [] }),
    canAddToCart,
  })

  let result
  try {
    result = await runChatAgent({
      model: openRouterModel(openRouterKey, settings.openrouter_model || 'openai/gpt-4o-mini'),
      system: systemPrompt,
      messages: buildModelMessages([...(history ?? [])].reverse(), userMessage),
      catalog,
      ordersEnabled: canAddToCart,
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
