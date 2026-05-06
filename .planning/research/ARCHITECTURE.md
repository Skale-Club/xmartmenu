# Architecture Patterns

**Domain:** AI-powered tenant onboarding integration (xmartmenu v1.2)
**Researched:** 2026-05-06
**Confidence:** HIGH — based on direct codebase inspection + verified Vercel docs

---

## Existing Architecture Baseline

The system is a Next.js 16.2 App Router application with these boundaries already
established:

- `src/app/api/onboarding/route.ts` — single POST that creates tenant → settings →
  profile → menu → category → product in one synchronous chain
- `src/app/onboarding/page.tsx` — 4-step wizard (company name + business type,
  contact info, menu name, first product), client component, posts to `/api/onboarding`
- `src/lib/upload.ts` — Sharp WebP conversion utility (5 MB limit, validate → convert → return Buffer)
- `src/app/api/superadmin/tenants/[id]/upload/route.ts` — multipart formData upload
  to `tenant-assets` Supabase Storage bucket, returns publicUrl
- DB tables that AI seeders must populate: `menus`, `categories`, `products`,
  `tenant_settings` (banner_url column), `products.image_url` / `products.image_urls`

---

## Recommended Architecture

Three independent AI paths, each as its own API route, all invoked from a new
onboarding step (Step 5) that appears after the existing Step 4 completes and the
tenant+menu exist.

```
src/app/onboarding/page.tsx
  └── Step 1-4 (unchanged): creates tenant, menu, first category+product
  └── Step 5 (new): AI seeding panel — three opt-in toggles
        ├── Toggle A: Text seeding  →  POST /api/ai/seed-text
        ├── Toggle B: Image seeding →  POST /api/ai/seed-images
        └── Toggle C: OCR upload    →  multipart POST /api/ai/ocr-menu
                                         └── review/edit UI before commit
                                               └── POST /api/ai/ocr-commit
```

### Why a separate Step 5 rather than modifying Step 4

The existing `/api/onboarding` route is synchronous and already has complex
fallback logic for schema version differences. AI calls are slow, expensive,
and partially opt-in. Injecting them into the existing route risks timeouts on
a path that must succeed for every tenant. Decoupling is safer.

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `src/app/onboarding/page.tsx` | Wizard state, navigation, calls all AI routes | All 4 API routes below |
| `POST /api/onboarding` | Unchanged — creates tenant scaffold | Supabase service client |
| `POST /api/ai/seed-text` | LLM text generation, bulk insert categories + products | OpenAI, Supabase service client |
| `POST /api/ai/seed-images` | DALL-E image generation, upload to Storage, update products | OpenAI, Supabase Storage, Supabase service client |
| `POST /api/ai/ocr-menu` | Receive photo, call GPT-4o vision, return structured draft | OpenAI, no DB write |
| `POST /api/ai/ocr-commit` | Receive user-reviewed draft, bulk insert to DB | Supabase service client |
| `AiSeedingPanel` (client component) | Render toggles, stream progress, review UI | `/api/ai/*` routes |

---

## API Routes: New vs Modified

### New routes (all under `src/app/api/ai/`)

**`POST /api/ai/seed-text`**

Request:
```typescript
{
  tenant_id: string      // already created by /api/onboarding
  menu_id: string
  business_type: string  // 'restaurant' | 'bar' | 'cafe' | 'other'
  company_name: string   // context for the prompt
  language: string       // from menu.language ('en' | 'pt' | etc.)
}
```

Response (streamed Server-Sent Events while generating, then final JSON):
```typescript
{
  categories: Array<{ name: string; description: string; products: Array<{ name: string; description: string; price: number }> }>
}
```

Server behavior:
1. Assert authenticated user owns `tenant_id` (check profile)
2. Call `openai.chat.completions.create({ model: 'gpt-4o-mini', stream: true, response_format: { type: 'json_object' }, ... })`
3. Stream SSE tokens back to the client so the UI can show live output
4. On stream end, bulk insert categories then products using service client
5. Return `{ categories_created, products_created }`

Set `export const maxDuration = 60` — text generation for 5-8 categories with
3-5 products each takes 10-20s but 60s gives headroom for slow completions.

---

**`POST /api/ai/seed-images`**

Request:
```typescript
{
  tenant_id: string
  product_ids: string[]   // up to 8; caller decides which products to illustrate
  generate_banner: boolean
}
```

Response (streaming progress via SSE):
```typescript
{ done: true; banner_url?: string; product_image_urls: Record<string, string> }
```

Server behavior:
1. Assert auth
2. Rate-limit guard: check `tenant_settings.ai_image_credits_used < LIMIT` (new column, or deny if already generated today)
3. For banner: call `openai.images.generate({ model: 'dall-e-3', size: '1792x1024', ... })`, fetch the returned URL as ArrayBuffer, convert to WebP with existing `validateAndConvertToWebP`, upload to `tenant-assets/{tenant_id}/banner.webp`, update `tenant_settings.banner_url`
4. For each product: call DALL-E 3 (`size: '1024x1024'`), fetch → WebP → upload to `tenant-assets/{tenant_id}/products/{product_id}.webp`, update `products.image_url` + append to `products.image_urls`
5. SSE event per image as it completes

Set `export const maxDuration = 300` — DALL-E 3 is 5-15s per image; 8 products +
1 banner = 9 sequential calls = up to 135s. With Fluid Compute (enabled by default
on all plans as of April 2025) the Hobby cap is 300s, so this fits.

Important: DALL-E 3 only supports `n=1` per call. Calls must be sequential or
you spawn parallel fetch chains — keep sequential for simplicity and predictable
cost, use SSE to keep the UI responsive.

---

**`POST /api/ai/ocr-menu`** (multipart form)

Request: `FormData` with `file: File` (photo of physical menu) + `tenant_id: string`

Response: structured draft (no DB write yet)
```typescript
{
  draft: {
    categories: Array<{
      name: string
      products: Array<{ name: string; description: string; price: number | null }>
    }>
  }
  raw_text: string  // full OCR extraction, for debug
}
```

Server behavior:
1. Assert auth
2. Accept multipart `formData()` — same pattern as existing upload route
3. Validate file (reuse `validateAndConvertToWebP` for size guard; for OCR, keep as JPEG/PNG — do NOT convert to WebP, OpenAI vision needs JPEG/PNG)
4. Convert File to base64 data URL
5. Call `openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: MENU_OCR_PROMPT }] }], response_format: { type: 'json_schema', json_schema: MENU_DRAFT_SCHEMA } })`
6. Parse and return draft — no DB write at this stage
7. Optionally upload the raw photo to `tenant-assets/{tenant_id}/ocr-source.jpg` for audit

Set `export const maxDuration = 60` — vision call with a full-page menu image
typically takes 10-25s.

---

**`POST /api/ai/ocr-commit`**

Request:
```typescript
{
  tenant_id: string
  menu_id: string
  draft: { categories: Array<{ name: string; products: Array<{ name: string; description: string; price: number | null }> }> }
}
```

Response:
```typescript
{ categories_created: number; products_created: number }
```

Server behavior: identical shape to what `/api/onboarding` does for category+product
creation, but loops over the full draft. Uses service client. No AI calls.

Set `export const maxDuration = 15` — pure DB inserts, no AI.

---

### Modified routes

**`POST /api/onboarding`** — no change to existing logic. The route stays exactly
as-is. The only addition: it now returns `tenant_id` and `menu_id` in the response
body alongside `tenant_slug` and `menu_slug`, because Step 5 needs those IDs to
call the AI routes. Current response only returns slugs.

Change: add `tenant_id: tenant.id, menu_id: menu.id` to the final
`NextResponse.json(...)` call.

---

## Data Flow to Existing DB Tables

### Text seeding (`/api/ai/seed-text`)

```
OpenAI response JSON
  → categories[]
      → INSERT INTO categories (tenant_id, menu_id, name, description, position, is_active)
      → for each category:
          → products[]
              → INSERT INTO products (tenant_id, menu_id, category_id, name, description, price, is_available, position)
```

No new columns needed. All fields map directly to existing schema.

### Image seeding (`/api/ai/seed-images`)

```
DALL-E 3 response (URL)
  → fetch(url) → ArrayBuffer → Buffer
  → sharp().webp({ quality: 85 }).toBuffer()
  → supabase.storage.from('tenant-assets').upload(path, buffer, { contentType: 'image/webp', upsert: true })
  → getPublicUrl(path)

Banner:
  → UPDATE tenant_settings SET banner_url = publicUrl WHERE tenant_id = ?

Per product:
  → UPDATE products SET image_url = publicUrl, image_urls = array_append(image_urls, publicUrl) WHERE id = ?
```

The `tenant-assets` bucket already exists (used by the superadmin upload route).
Storage paths follow the existing convention `{tenant_id}/{type}.{ext}`.

### OCR commit (`/api/ai/ocr-commit`)

Same insert pattern as text seeding. Draft reviewed by user first, then committed.
Prices from OCR may be null — insert as `0` with a note, user edits later.

---

## Vercel Timeout Constraints and Strategy

Vercel Fluid Compute is enabled by default for all plans as of April 2025.
Hobby plan: 300s maximum duration (confirmed from official Vercel docs, February 2026).

| Route | Strategy | maxDuration |
|-------|----------|-------------|
| `/api/ai/seed-text` | Server-Sent Events streaming — first token arrives in 1-2s, UI shows live output | 60s |
| `/api/ai/seed-images` | SSE progress events per image — UI shows each image as it completes | 300s |
| `/api/ai/ocr-menu` | Single blocking call — GPT-4o vision, 10-25s typical | 60s |
| `/api/ai/ocr-commit` | Pure DB inserts, no AI | 15s |

### SSE Pattern for Next.js App Router

```typescript
// app/api/ai/seed-text/route.ts
export const maxDuration = 60

export async function POST(request: Request) {
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  void (async () => {
    const completion = await openai.chat.completions.create({ stream: true, ... })
    for await (const chunk of completion) {
      const token = chunk.choices[0]?.delta?.content ?? ''
      await writer.write(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`))
    }
    await writer.write(encoder.encode(`data: [DONE]\n\n`))
    await writer.close()
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

### Why not Edge Functions for AI routes

Edge functions have a 25 MB memory limit and no Node.js APIs. Sharp (used for
WebP conversion) requires Node.js. The image seeding route needs Sharp.
Use Node.js runtime (default) for all AI routes.

### Why not background jobs (QStash, Inngest) for this milestone

Background jobs solve the problem of "fire and forget then poll for results."
For onboarding, the user is watching a progress screen — they need real-time
feedback. SSE achieves this without introducing a new service dependency. At the
scale of new tenant onboarding (not a high-throughput path), background jobs
add complexity with no benefit.

---

## Review / Edit UI Architecture (OCR path)

The OCR flow requires a user review screen before committing because extraction
quality varies: prices may be wrong, items may be merged, categories may be
mis-inferred.

### State machine in `page.tsx`

```
Step 4 complete
  → Step 5: AI panel (toggles)
    → OCR upload selected
      → loading state (waiting for /api/ai/ocr-menu)
      → review state (draft displayed as editable form)
        → user edits name / description / price / deletes items
        → "Save Menu" → POST /api/ai/ocr-commit
          → Step 6: success (same as current Step 5)
```

### Review component structure

`OcrReviewPanel` (client component, inline in onboarding page or separate file):

- Renders `draft.categories` as an accordion or flat list
- Each category name: editable `<input>`
- Each product row: editable name, description, price fields; delete button
- "Add item" button per category
- "Add category" button at bottom
- "Save Menu" calls `handleOcrCommit(reviewedDraft)`

This keeps all state in React (`useState` on `reviewedDraft`). No server round-trips
during editing. The single commit call at the end is atomic.

### No optimistic DB writes during review

Do not persist the OCR draft to the DB while the user edits it. Storing a
"pending_draft" in a new table adds migration complexity with minimal benefit.
Keep it in client state. If the user refreshes, they re-upload — this is
acceptable for an onboarding wizard that users complete in one sitting.

---

## Suggested Build Order Across Phases

Dependencies drive the order. Text seeding is the foundation (no binary assets,
pure DB inserts, lowest risk). Image seeding depends on Storage patterns proven
in text seeding phase. OCR has a review UI dependency — it's the most complex UX
piece and benefits from the prompt engineering patterns established in text seeding.

### Phase 1: Text seeding + onboarding Step 5 scaffold

Deliverables:
- Step 5 AI panel in `page.tsx` with toggle UI
- `/api/ai/seed-text` with OpenAI integration + SSE streaming
- Bulk insert of LLM-generated categories and products
- Modify `/api/onboarding` to return `tenant_id` + `menu_id`
- Feature flag: env var `NEXT_PUBLIC_AI_ONBOARDING_ENABLED` — if false, Step 5 is skipped

Why first: validates the OpenAI integration, prompt design, and SSE pattern
with the lowest-risk path (text is free to regenerate, no storage costs).

### Phase 2: Image seeding

Deliverables:
- `/api/ai/seed-images` with DALL-E 3 + Sharp + Supabase Storage upload
- SSE per-image progress events
- Rate limiting guard (simple: check if images already generated for this tenant today)
- UI in Step 5 toggle panel showing generated images with accept/skip per item

Why second: depends on Storage upload patterns from Phase 1 feedback, and the
product IDs created by text seeding are the natural input for image seeding.

### Phase 3: OCR menu photo

Deliverables:
- `/api/ai/ocr-menu` with GPT-4o vision + structured output schema
- `OcrReviewPanel` component (full edit UI)
- `/api/ai/ocr-commit` for reviewed draft persistence
- File upload handling (multipart formData, validation, base64 conversion)

Why third: highest UX complexity (review/edit screen), benefits from prompt
engineering experience gained in Phase 1. Also independent of Phases 1-2 at
the DB level — can be enabled separately with its own feature flag.

---

## Architecture Anti-Patterns to Avoid

### Anti-Pattern 1: Injecting AI calls into `/api/onboarding`

**What goes wrong:** The existing route is a synchronous fallback chain with 5
payload candidates for schema version differences. Adding 30s+ AI calls to it
makes every tenant creation slow and risks timeouts on the critical path.

**Instead:** Keep `/api/onboarding` as a fast, deterministic scaffold. AI seeding
is a separate, opt-in step that runs after the tenant exists.

### Anti-Pattern 2: Streaming the full categories+products JSON as a single blob

**What goes wrong:** If the LLM generates 8 categories × 5 products, the full
JSON is 3-5 KB. Sending it as one response means the user waits 15-20s with no
feedback. Risk of timeout on slow networks.

**Instead:** Use SSE to stream tokens. The client accumulates the JSON and shows
partial content. When `[DONE]` arrives, the client triggers the commit.

### Anti-Pattern 3: Using edge runtime for image routes

**What goes wrong:** Edge runtime lacks Node.js APIs. Sharp, which is already
used in `src/lib/upload.ts`, requires Node.js native bindings.

**Instead:** All AI routes use Node.js runtime (default). No `export const runtime = 'edge'` on AI routes.

### Anti-Pattern 4: Auto-committing OCR results without review

**What goes wrong:** GPT-4o vision extracts menu content accurately at the
category/item name level but prices are often wrong (handwriting, unclear
formatting, decimals). Auto-committing means the restaurant owner's menu has
wrong prices on day one.

**Instead:** Always route OCR output through the review/edit screen. The UI must
be the commit gate.

### Anti-Pattern 5: Generating images for all products unconditionally

**What goes wrong:** DALL-E 3 costs ~$0.04/image at standard quality. A seeded
menu with 40 products = $1.60 per onboarding. At scale this is a meaningful cost
and could be abused.

**Instead:** Image seeding is opt-in per toggle AND rate-limited per tenant (e.g.,
max 8 images per onboarding run, one banner). Implement the guard before the DALL-E
call.

---

## Scalability Considerations

| Concern | At 10 tenants/day | At 100 tenants/day |
|---------|------------------|--------------------|
| OpenAI API costs (text) | Negligible | ~$2-5/day (gpt-4o-mini) |
| OpenAI API costs (images) | ~$3/day (8 img × $0.04) | ~$30/day — needs credit system |
| Supabase Storage | Negligible | Negligible |
| Vercel function concurrency | No issue | No issue (onboarding is low-frequency) |
| OpenAI rate limits | No issue | Monitor — gpt-4o-mini has generous limits |

At 100 tenants/day with all features opted in, image generation cost becomes
meaningful. The rate-limit guard (Phase 2) is sufficient for v1.2. A credit
balance system can be added in a future seed.

---

## Sources

- Vercel Fluid Compute duration limits: https://vercel.com/docs/functions/configuring-functions/duration (verified 2026-02-27)
- OpenAI structured outputs + vision compatibility: https://platform.openai.com/docs/guides/structured-outputs
- DALL-E 3 API specifications (n=1 only, sizes): https://developers.openai.com/api/docs/models/dall-e-3
- Existing codebase: `src/app/api/onboarding/route.ts`, `src/lib/upload.ts`, `src/app/api/superadmin/tenants/[id]/upload/route.ts`, `src/types/database.ts`
- Vercel AI SDK streaming pattern: https://ai-sdk.dev/docs/getting-started/nextjs-app-router
