/**
 * Public AI chat streaming endpoint.
 *
 * - Validates conversation_id belongs to the tenant
 * - Enforces rate limit (rate_limit_per_phone_per_day) and blocklist
 * - Decrypts the tenant's OpenRouter API key
 * - Builds the system prompt with full menu context + guardrails
 * - Streams the response via Vercel AI SDK; persists user + assistant messages on finish
 *
 * The addToCart tool emits structured tool calls that the client widget
 * intercepts and applies to the existing in-memory cart context — there is no
 * server-side cart state to mutate here.
 */
import { NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'
import { buildMenuContext, countMessagesLast24h, getChatAddonStatus } from '@/lib/chat-addon'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ChatRequestBody {
  conversation_id: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const rl = await rateLimit('chat-message', getClientIp(request), 20, '1 m')
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const { conversation_id, messages } = (await request.json()) as ChatRequestBody

  if (!conversation_id || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'conversation_id and messages are required' }, { status: 400 })
  }
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser || !lastUser.content?.trim()) {
    return NextResponse.json({ error: 'No user message' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Resolve tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, tenant_settings(orders_enabled, address, phone, business_hours, business_type)')
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

  // Build system prompt
  const settingsRow = (tenant.tenant_settings as any) ?? {}
  const ordersEnabled: boolean = !!settingsRow.orders_enabled
  const menuContext = await buildMenuContext(supabase, tenant.id)
  const hoursStr = settingsRow.business_hours
    ? Object.entries(settingsRow.business_hours).map(([d, h]) => `${d}: ${h}`).join(' | ')
    : 'not provided'

  const systemPrompt = `You are a friendly restaurant assistant for ${tenant.name}.
You help customers explore the menu, understand dishes, discover great combinations,
and place orders when available.

MENU CONTEXT:
${menuContext}

RESTAURANT INFO:
- Address: ${settingsRow.address ?? 'not provided'}
- Phone: ${settingsRow.phone ?? 'not provided'}
- Hours: ${hoursStr}
- Cuisine: ${settingsRow.business_type ?? 'not provided'}

ORDERING:
${ordersEnabled
  ? 'You CAN help the customer add items to their cart using the addToCart tool. Call it whenever the customer explicitly asks to add, order, or include items.'
  : 'You CANNOT place orders or add items to a cart. This restaurant uses digital menus for browsing only. Politely inform the customer if they ask to order.'}

GUARDRAILS — STRICT:
- Only discuss: menu items, ingredients, prices, promotions, dish combinations, food/drink harmonization, and allergen questions.
- For any other topic (politics, weather, jokes, general knowledge, competitors, personal advice), respond: "I'm only able to help with our menu and dishes. Is there something you'd like to know about our food?"
- Never invent menu items, prices, or ingredients not listed above.
- Never discuss competitor restaurants.
- Be warm, concise, and helpful. Maximum 3 sentences per response unless listing items.
- Respond in the language the customer uses.`

  // OpenRouter is OpenAI-compatible — point @ai-sdk/openai at it
  const openrouter = createOpenAI({
    apiKey: openRouterKey,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  const tools = ordersEnabled
    ? {
        addToCart: tool({
          description: 'Add one or more menu items to the customer cart. Use the exact product_id values from MENU CONTEXT.',
          inputSchema: z.object({
            items: z.array(z.object({
              product_id: z.string().describe('UUID of the product from MENU CONTEXT'),
              name: z.string().describe('Product name (for confirmation/display)'),
              quantity: z.number().int().positive().default(1),
              unit_price: z.number().describe('Base price in the menu currency'),
              note: z.string().optional(),
            })).min(1).max(20),
          }),
          execute: async ({ items }) => ({
            ok: true,
            added: items.map((i) => ({ name: i.name, quantity: i.quantity })),
          }),
        }),
      }
    : undefined

  const userMessage = lastUser.content.trim()

  let result
  try {
    result = await generateText({
      model: openrouter(settings.openrouter_model || 'openai/gpt-4o-mini') as any,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools as any,
      maxRetries: 1,
    })
  } catch (e) {
    console.error('chat.generate_error', e)
    return NextResponse.json({ error: 'Assistant temporarily unavailable' }, { status: 502 })
  }

  // Persist user + assistant turns; bump conversation aggregates.
  const nowIso = new Date().toISOString()
  await supabase.from('chat_messages').insert([
    {
      conversation_id: convo.id,
      role: 'user',
      content: userMessage,
      created_at: nowIso,
    },
    {
      conversation_id: convo.id,
      role: 'assistant',
      content: result.text || '',
      created_at: nowIso,
      tokens_used: (result.usage as any)?.totalTokens ?? null,
    },
  ])
  await supabase
    .from('chat_conversations')
    .update({
      last_message_at: nowIso,
      message_count: (convo.message_count ?? 0) + 2,
    })
    .eq('id', convo.id)

  // Extract addToCart tool calls (if any)
  const cartItems: Array<{ product_id: string; name: string; quantity: number; unit_price: number; note?: string }> = []
  for (const tc of (result as any).toolCalls ?? []) {
    if (tc.toolName === 'addToCart' && tc.input?.items) {
      for (const i of tc.input.items) cartItems.push(i)
    }
  }

  return NextResponse.json({
    text: result.text || '',
    cart_items: cartItems,
    remaining_today: Math.max(0, limit - used - 1),
  })
}
