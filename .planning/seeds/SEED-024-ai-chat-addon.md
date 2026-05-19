---
id: SEED-024
status: dormant
planted: 2026-05-19
planted_during: v2.2-milestone-planning
trigger_when: ready to monetize AI capabilities as a restaurant-facing addon
scope: large
---

# SEED-024: AI Chat Addon

## Why This Matters

Customers landing on a restaurant's public menu have no guidance. They scroll, guess, and often order the same thing every visit. An AI chat assistant embedded in the menu page changes this: it recommends dishes by occasion and preference, explains harmonization and combinations, answers questions about ingredients, and — when the restaurant's plan supports it — builds the order and adds items directly to the cart.

This is a **paid addon** ($20/month on top of the base plan). The restaurant brings its own OpenRouter API key and pays for AI usage directly, keeping the platform's operating cost at zero per conversation. Audio transcription (STT only) is an optional toggle with a separate provider key.

**What this is NOT:**
- Not a general-purpose chatbot — guardrails restrict responses to menu, food, prices, and promotions only
- Not a replacement for the human ordering flow — cart actions mirror what the customer could do manually
- Not a full voice assistant — audio is STT only (voice → text); the AI always responds in text
- Not a tenant-facing AI tool the restaurant staff configures from scratch — the superadmin manages plan availability; the restaurant admin configures their own keys

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| AI provider | OpenRouter (customer-owned API key) | Platform pays nothing per conversation; customer controls model selection and cost |
| Audio | STT only — Whisper or Deepgram | Lower complexity, no TTS; separate API key from chat key |
| Guardrail scope | Menu, dishes, prices, promotions only | Narrow scope = safer, simpler system prompt, less hallucination risk |
| Phone gate | Required before chat opens | Rate limiting anchor + contact info for restaurant; no full auth needed |
| Conversation history | Persisted per phone number, but AI context is session-scoped | Restaurant can audit full history; AI doesn't assume yesterday's order carries over |
| Cart integration | Injects into existing in-memory cart via React context | Zero duplicate state; same cart the customer uses manually |
| Plan awareness | `orders_enabled` flag injected into system prompt | Chat operates in recommendation-only mode when orders are off |
| Inbox | History + moderation (block number, mark, export CSV) | Restaurant has control without needing live intervention |
| Billing model | Stripe addon subscription ($20/month) on top of base plan | Matches existing subscription infrastructure from v2.0 |

---

## When to Surface

**Trigger:** when the restaurant platform is ready to monetize AI features, or when a restaurant partner requests AI-assisted customer interaction.

Surface during `/gsd:new-milestone` when the scope involves:
- Restaurant-facing AI features
- Customer engagement tools
- Monetization of platform capabilities
- Chat or conversational commerce

---

## Scope Estimate

**Large** — 5–8 days. Seven independent phases:

---

### Phase A: Schema + Infrastructure

**Goal:** All database tables, TypeScript types, API key encryption utility, and plan feature flag are in place before any UI or AI work begins.

**DB changes:**
- `chat_addon_settings` table:
  ```
  tenant_id (FK, unique), enabled BOOLEAN DEFAULT false,
  openrouter_api_key TEXT (AES-256 encrypted),
  openrouter_model TEXT DEFAULT 'openai/gpt-4o-mini',
  audio_enabled BOOLEAN DEFAULT false,
  audio_provider TEXT CHECK IN ('whisper', 'deepgram'),
  audio_api_key TEXT (AES-256 encrypted),
  rate_limit_per_phone_per_day INT DEFAULT 30
  ```
- `chat_conversations` table:
  ```
  id UUID PK, tenant_id (FK), phone_hash TEXT (SHA-256),
  started_at TIMESTAMPTZ, last_message_at TIMESTAMPTZ,
  message_count INT DEFAULT 0, status TEXT DEFAULT 'active' CHECK IN ('active', 'blocked')
  ```
- `chat_messages` table:
  ```
  id UUID PK, conversation_id (FK), role TEXT CHECK IN ('user', 'assistant'),
  content TEXT, created_at TIMESTAMPTZ, has_audio BOOLEAN DEFAULT false,
  tokens_used INT
  ```
- `chat_blocked_phones` table:
  ```
  id UUID PK, tenant_id (FK), phone_hash TEXT, blocked_at TIMESTAMPTZ,
  blocked_by UUID (FK profiles), reason TEXT
  ```
- Extend `plans` table: `chat_addon_available BOOLEAN DEFAULT false`
- Extend `tenant_subscriptions`: `chat_addon_active BOOLEAN DEFAULT false, chat_addon_since TIMESTAMPTZ`
- `src/lib/crypto.ts`: `encryptApiKey(key) / decryptApiKey(ciphertext)` using AES-256-GCM with env-var master key
- TypeScript interfaces: `ChatAddonSettings`, `ChatConversation`, `ChatMessage`, `ChatBlockedPhone`

**RLS:** `chat_conversations` and `chat_messages` — public read insert for customer flow (no auth); admin read via service client. `chat_addon_settings` and `chat_blocked_phones` — tenant_id isolation (same pattern as all other tenant tables).

---

### Phase B: Admin Settings UI

**Goal:** Restaurant admin can configure the AI chat addon from their settings panel. The section is visible only when the tenant's plan has `chat_addon_available = true`; an "Upgrade" prompt is shown otherwise.

**UI — new "AI Chat" section in Admin Settings:**
1. **Addon status banner** — shows "Active" or "Upgrade to enable" based on plan
2. **Enable/disable toggle** — master switch; disabling hides the widget from the public menu immediately
3. **OpenRouter configuration:**
   - API key input (masked, reveals on click)
   - Model selector: static list of OpenRouter-compatible models (GPT-4o-mini, Claude Haiku, Gemini Flash, Llama, Mixtral, etc.)
   - "Test connection" button — sends a minimal probe request to OpenRouter with the key
4. **Rate limit:** numeric input — messages per phone number per day (default 30, min 5, max 200)
5. **Audio section** (visible only when `audio_enabled` toggle is on):
   - Provider selector: Whisper (OpenAI) | Deepgram
   - Audio API key input (masked)
   - "Test audio" button

**API routes:**
- `GET /api/admin/chat-addon/settings` — returns settings with masked keys
- `PUT /api/admin/chat-addon/settings` — updates settings (encrypts keys before storing)
- `POST /api/admin/chat-addon/test-connection` — probes OpenRouter with provided key

---

### Phase C: OpenRouter AI Core + Guardrails

**Goal:** A working AI endpoint that accepts a conversation, injects full restaurant context into the system prompt, enforces guardrails, and responds with structured tool calls for cart operations.

**Provider integration:**
- OpenRouter is OpenAI-compatible — use `openai` provider from `@ai-sdk/openai` with custom `baseURL: 'https://openrouter.ai/api/v1'` and the decrypted tenant API key
- No Vercel AI Gateway — calls go directly to OpenRouter on behalf of the tenant

**System prompt — injected context:**
```
You are a friendly restaurant assistant for {tenantName}.
You help customers explore the menu, understand dishes, discover great combinations,
and place orders when available.

MENU CONTEXT:
{serializedMenuWithCategoriesProductsOptionsPrices}

RESTAURANT INFO:
- Address: {address}
- Phone: {phone}
- Hours: {hours}
- Cuisine: {businessType}

ORDERING:
{if orders_enabled}
You CAN help the customer add items to their cart using the addToCart tool.
{else}
You CANNOT place orders or add items to a cart. This restaurant uses digital menus for
browsing only. Politely inform the customer if they ask to order.
{/if}

GUARDRAILS — STRICT:
- Only discuss: menu items, ingredients, prices, promotions, dish combinations,
  food/drink harmonization, and allergen questions.
- For any other topic (politics, weather, jokes, general knowledge, competitors,
  personal advice), respond: "I'm only able to help with our menu and dishes.
  Is there something you'd like to know about our food?"
- Never invent menu items, prices, or ingredients not listed above.
- Never discuss competitor restaurants.
- Be warm, concise, and helpful. Maximum 3 sentences per response unless listing items.
```

**Tools:**
- `addToCart({ items: [{ product_id, name, quantity, selected_options, unit_price }] })` — emits a structured data part that the client widget intercepts and injects into the MenuPage cart context. Only registered when `orders_enabled = true`.
- `getProductDetails({ product_id })` — queries the DB for full product details (options, ingredients). Used when customer asks for specifics.

**API route:** `POST /api/public/chat/[tenantSlug]`
- No auth required (public route)
- Validates `conversation_id` exists and belongs to tenant
- Checks rate limit: counts `chat_messages` for `phone_hash` today; returns 429 with message if exceeded
- Checks phone not in `chat_blocked_phones`
- Decrypts OpenRouter key from `chat_addon_settings`
- Streams AI response via Vercel AI SDK `streamText()`
- Persists user message + assistant response to `chat_messages` on finish
- Increments `chat_conversations.message_count`

**Rate limit logic:** `SELECT count(*) FROM chat_messages cm JOIN chat_conversations cc ON cc.id = cm.conversation_id WHERE cc.tenant_id = $1 AND cc.phone_hash = $2 AND cm.created_at > now() - interval '1 day' AND cm.role = 'user'`

---

### Phase D: Public Chat Widget + Phone Gate

**Goal:** A floating chat button appears on the public menu page (when addon is enabled). Clicking it opens a phone gate, then the chat interface. Cart tool calls from the AI are intercepted and applied to the existing MenuPage cart.

**Phone gate flow:**
1. Chat button appears bottom-right of public menu (only when `chat_addon_settings.enabled = true`)
2. First click → phone gate modal:
   - "Chat with our AI assistant about our menu"
   - Phone input with international format validation
   - Submit → `POST /api/public/chat/[tenantSlug]/session` — creates or retrieves `chat_conversations` row for `(tenant_id, phone_hash)` of today's date; returns `conversation_id`
   - If phone is blocked → show "This number is not allowed to use this service"
   - Phone stored in `sessionStorage` so gate doesn't reappear on same tab
3. Chat opens with welcome message from AI

**Chat UI component (`components/menu/AiChatWidget.tsx`):**
- Floating button with chat bubble icon (hidden when addon disabled)
- Slide-up panel (mobile-first, 400px on desktop)
- Message list: user messages right-aligned, AI messages left-aligned
- Text input + send button
- Audio record button (mic icon, visible only when `audio_enabled = true`)
- Typing indicator during streaming
- "30 messages remaining today" counter (optional, from rate limit check)
- Cart action toast: when AI calls `addToCart`, show "Added X items to your cart ✓"

**Cart bridge:**
- `MenuPage.tsx` already manages cart state. Expose `addItemsToCart(items[])` via React context or callback prop
- `AiChatWidget` receives this callback and calls it when the AI stream emits a `tool-result` part for `addToCart`
- Cart state updates in real-time — customer sees items appear in cart while chatting

**Session endpoint:** `POST /api/public/chat/[tenantSlug]/session`
- Body: `{ phone: string }`
- Validates phone format; hashes with SHA-256 (salt = tenant_id) before storing
- Upserts `chat_conversations` by `(tenant_id, phone_hash, date(now()))` — one conversation per phone per day
- Returns `{ conversation_id, messages_today, rate_limit }`

---

### Phase E: Chat Inbox + Moderation

**Goal:** Restaurant admin can monitor all AI chat conversations, view full threads, block phone numbers, and export conversation logs.

**New admin section: "Chat Inbox" (sidebar nav item, visible when addon enabled)**

**List view:**
- Columns: Phone (masked: `+55 11 ****-5678`), Date, Messages, Last message preview, Status (active/blocked)
- Sorted by `last_message_at DESC`
- Filter bar: date range, status filter (active/blocked), search by masked phone
- Pagination: 50 conversations per page

**Thread view (click a row):**
- Full conversation: messages in chronological order with timestamps
- Role labels: Customer / AI Assistant
- Actions bar:
  - "Block this number" → opens reason input → inserts into `chat_blocked_phones`; ends any active conversation
  - "Export conversation" → downloads as CSV (`timestamp, role, content`)
  - "Add note" → internal note on the conversation (stored in `chat_conversations.admin_note TEXT`)

**Blocked phones list:**
- Separate tab/sub-section: table of blocked numbers (masked), reason, blocked date, "Unblock" action

**API routes:**
- `GET /api/admin/chat-addon/conversations` — paginated list with filters
- `GET /api/admin/chat-addon/conversations/[id]` — full thread
- `POST /api/admin/chat-addon/conversations/[id]/block` — block phone
- `DELETE /api/admin/chat-addon/blocked/[id]` — unblock
- `GET /api/admin/chat-addon/conversations/[id]/export` — CSV download

---

### Phase F: Audio STT

**Goal:** Customer can tap a microphone button in the chat widget, record a voice message, and have it transcribed to text which is then sent to the AI as a normal text message.

**Client flow:**
1. Customer taps mic button → browser requests microphone permission
2. Recording starts (visual indicator: red dot, elapsed timer)
3. Customer taps stop → audio blob created via `MediaRecorder` API
4. `POST /api/public/chat/[tenantSlug]/audio` with audio blob (multipart)
5. Server transcribes via Whisper or Deepgram using `audio_api_key`
6. Returns `{ transcript: string }`
7. Transcript fills the text input → customer can review/edit before sending
8. Sending works exactly like a typed message

**Server route `POST /api/public/chat/[tenantSlug]/audio`:**
- Validates `conversation_id` (same session check as chat route)
- Checks `audio_enabled = true` on tenant settings
- Routes to Whisper (`openai.audio.transcriptions.create`) or Deepgram REST API based on `audio_provider`
- Uses decrypted `audio_api_key`
- Returns transcript; does NOT persist audio file (transcription only)
- Max audio size: 10 MB; supported formats: webm, mp4, ogg, wav

**Admin settings** (Phase B already built the UI): audio section becomes functional once this phase ships.

---

### Phase G: Addon Billing + Activation Flow

**Goal:** The chat addon is a purchasable $20/month add-on via Stripe, managed through the existing subscription infrastructure. Superadmin controls plan availability; tenants activate from the admin panel.

**Superadmin changes:**
- Plans table: `chat_addon_available` toggle per plan in the superadmin plan editor
- Tenant detail page: "Chat Addon" override toggle (force-enable/disable for a specific tenant regardless of plan)

**Tenant activation flow:**
- Admin Settings → AI Chat section (Phase B) shows "Upgrade" banner when `chat_addon_available = false` on their plan
- "Activate Chat Addon — $20/month" button → Stripe Checkout session for the addon subscription
- On successful payment: Stripe webhook sets `tenant_subscriptions.chat_addon_active = true, chat_addon_since = now()`
- Cancellation webhook sets `chat_addon_active = false`; existing `chat_addon_settings.enabled` is also set to `false` automatically

**Stripe integration:**
- New Stripe Price object: $20/month recurring, metadata `{ type: 'chat_addon' }`
- Webhook event handling: `customer.subscription.updated` — detect `chat_addon` metadata and update DB
- `GET /api/admin/chat-addon/billing` — returns addon subscription status and next billing date
- Idempotency: same pattern as Phase 33 webhook handler

**Plan check utility:**
- `getChatAddonStatus(tenantId)` → checks `tenant_subscriptions.chat_addon_active` OR superadmin override
- Called by admin settings page, public widget check, and chat API route

---

## Breadcrumbs

- `supabase/migrations/` — chat_addon_settings, chat_conversations, chat_messages, chat_blocked_phones; plans.chat_addon_available; tenant_subscriptions.chat_addon_active
- `src/types/database.ts` — ChatAddonSettings, ChatConversation, ChatMessage, ChatBlockedPhone types
- `src/lib/crypto.ts` — encryptApiKey / decryptApiKey (AES-256-GCM)
- `src/lib/chat-addon.ts` — getChatAddonStatus(), buildMenuContext(), checkRateLimit()
- `src/app/api/public/chat/[slug]/route.ts` — main AI streaming endpoint
- `src/app/api/public/chat/[slug]/session/route.ts` — phone gate + conversation creation
- `src/app/api/public/chat/[slug]/audio/route.ts` — STT transcription
- `src/app/api/admin/chat-addon/settings/route.ts` — settings CRUD
- `src/app/api/admin/chat-addon/conversations/route.ts` — inbox list + thread
- `src/app/api/admin/chat-addon/billing/route.ts` — subscription status
- `src/app/(admin)/settings/chat/page.tsx` — admin settings UI (new)
- `src/app/(admin)/chat-inbox/page.tsx` — inbox + moderation UI (new)
- `src/components/menu/AiChatWidget.tsx` — floating chat button + panel + phone gate
- `src/app/(public)/[slug]/page.tsx` — pass chat addon status + inject AiChatWidget
- `src/components/menu/MenuPage.tsx` — expose addItemsToCart via context for cart bridge
- `src/app/(superadmin)/tenants/[id]/page.tsx` — chat addon override toggle
- `src/middleware.ts` — `/api/public/chat/*` must bypass auth (public routes)

---

## Coordinates with

- **SEED-009 (Monetization)** — uses existing `plans`, `tenant_subscriptions`, Stripe webhook infrastructure
- **SEED-013 (Order Types)** — `orders_enabled` flag controls whether chat can build orders
- **SEED-011 (Multi-Location)** — future: branch-scoped chat (each branch could have its own chat widget)
- **SEED-018 (Customer Phone OTP Login)** — if OTP login ships, phone gate could integrate with that session

---

## Notes

- **OpenRouter API key lives on the tenant, never on the platform.** Encrypted at rest with AES-256-GCM. Master encryption key stored as env var `CHAT_ADDON_ENCRYPTION_KEY`. Key is decrypted server-side at request time — never sent to the client.
- **Phone hashing:** SHA-256(phone + tenant_id) — same phone number hashes differently per tenant. Restaurant cannot cross-reference customers across tenants.
- **No conversation history injected into AI context.** Each new session starts fresh. The AI only sees the current session's messages (standard sliding window). Historical conversations are for the restaurant's inbox only.
- **AI response language:** matches the customer's language automatically (OpenRouter models are multilingual). System prompt written in English but AI will respond in whatever language the customer uses.
- **Cart tool is additive only.** The AI can only add items to the cart, never remove or modify existing items. Removal is the customer's responsibility via the normal cart UI.
- **Guardrail failure mode:** if OpenRouter returns an error or the key is invalid, the widget shows a friendly "Our assistant is temporarily unavailable" message. Never exposes API errors to the customer.
- **SEED-018 coordinate:** if customer phone OTP login (SEED-018) ships, the phone gate could reuse the OTP verification for stronger identity. For this seed, phone is unverified — it's a soft gate for rate limiting and contact info, not identity verification.
