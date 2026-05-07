# Phase 11: Menu Photo OCR — Research

**Researched:** 2026-05-07
**Domain:** Supabase Storage signed uploads, AI SDK v6 vision/structured output, GPT-4.1-mini
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two-step upload: (1) GET signed upload URL, (2) client uploads directly to Supabase Storage, (3) POST storage path to process route. Bypasses Vercel 4.5 MB body limit.
- **D-02:** Storage bucket: `tenant-assets`, path: `{tenant_id}/ocr/{timestamp}-{filename}`. No upsert needed.
- **D-03:** UI hint: "Max ~4 MB recommended for best OCR results." Client validates > 4 MB and shows warning.
- **D-04:** GPT-4.1-mini for OCR. Uses `@ai-sdk/openai` (not yet installed). Env var: `OPENAI_API_KEY`.
- **D-05:** `export const runtime = 'nodejs'`, `export const maxDuration = 60`.
- **D-06:** GPT-4.1-mini extracts: category names, product names, prices (numeric), descriptions (null if not visible).
- **D-07:** Output JSON: `{ categories: [{ name, products: [{ name, price, description }] }] }`.
- **D-08:** Additive only. Case-insensitive name match. If category/product exists, skip. Safe to re-run.
- **D-09:** Write targets: `categories.name`, `products.name/price/description/menu_id/tenant_id`. Position = max + 1.
- **D-10:** `revalidatePath()` after all writes.
- **D-11:** Price parsing: GPT returns numeric only. Handles Brazilian locale, integers, ranges (lower bound).
- **D-12:** Failed price = `price: 0`. No new DB column. Price 0 in admin UI = signal to fix manually.
- **D-13:** Products with `price: 0` or `price: null` are inserted with `price = 0` (NOT NULL satisfied).
- **D-14:** New "OCR" sub-section in AI Tools section of `TenantDetailClient.tsx`, after Image Seeding.
- **D-15:** `<input type="file" accept="image/*">`. No drag-and-drop. Client warns if > 4 MB.
- **D-16:** `ai_usage` row: `feature_key = 'ocr_menu'`, non-blocking, after GPT call.
- **D-17:** No `sanitizeForPrompt()` on the storage path. System prompt is hardcoded, no tenant-string interpolation.
- **D-18:** `assertSuperadmin()` on every route. `tenant_id` from URL param.

### Claude's Discretion

- Exact GPT-4.1-mini model string (confirmed by research below: `gpt-4.1-mini`).
- Whether signed URL endpoint and process endpoint are separate files or one route with GET/POST.
- Position ordering for extracted categories/products (extraction order preferred over alphabetical).
- Whether to clean up OCR photo after processing (default: leave it).
- Exact prompt engineering for GPT-4.1-mini vision.

### Deferred Ideas (OUT OF SCOPE)

- Review screen before committing OCR output.
- Multiple photo uploads per OCR run.
- Handwritten menu OCR / photo enhancement.
- Price range support beyond lower bound.
- Image compression client-side.
- OCR photo cleanup from Storage.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-10 | Superadmin can upload a menu photo from the superadmin tenant view; upload goes directly to Supabase Storage (bypasses Vercel 4.5 MB request body limit) | Supabase `createSignedUploadUrl` + `uploadToSignedUrl` confirmed; two-step flow pattern documented |
| AI-11 | System extracts categories, item names, and prices from the photo via GPT-4.1-mini vision, writes directly to tenant's `categories` and `products` tables | GPT-4.1-mini vision confirmed; AI SDK v6 image input format confirmed; additive write pattern from Phase 9 |
| AI-12 | OCR-extracted prices that fail parsing are saved as `0`; superadmin fixes in admin UI | No new column needed; `price = 0` is intentional; confirmed DB schema accepts it |
</phase_requirements>

---

## Summary

Phase 11 adds a Superadmin-only menu photo OCR feature. The three-step flow (get signed URL → browser upload to Storage → server downloads and calls GPT-4.1-mini) bypasses Vercel's 4.5 MB serverless body limit. The architecture closely mirrors the existing Phase 9/10 patterns for auth, DB writes, ai_usage logging, and revalidatePath.

Two packages need attention: `@ai-sdk/openai@^3` (not yet installed) and `OPENAI_API_KEY` (not yet in env). The rest of the stack is already in place. The biggest implementation subtlety is using the correct AI SDK v6 API for structured vision output (`generateText` + `Output.object` is the v6-preferred pattern; `generateObject` still works in 6.0.175 but is deprecated per migration guide).

Supabase Storage's `createSignedUploadUrl` returns `{ data: { signedUrl, token, path }, error }`. The browser calls `supabase.storage.from('tenant-assets').uploadToSignedUrl(path, data.token, file)` — requires the anon Supabase client on the client side. Alternatively, the browser can `fetch(signedUrl, { method: 'PUT', body: file })` directly without the SDK.

**Primary recommendation:** Install `@ai-sdk/openai@^3`, add `OPENAI_API_KEY` to env, implement `generateText` + `Output.object` with `messages` containing an image part (Buffer from Supabase Storage download). Use `openai('gpt-4.1-mini')` as the model string.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ai-sdk/openai` | `^3.0.62` (latest) | OpenAI provider for AI SDK v6 | Only first-party OpenAI provider compatible with `ai@^6`. Version `^3` aligns with all other `@ai-sdk/*` packages at `3.x`. |
| `ai` | `6.0.175` (installed) | `generateText`, `Output`, structured output | Already installed. `generateText` + `Output.object` is the v6 pattern for structured data. |
| `@supabase/supabase-js` | `^2.101.1` (installed) | Storage signed URLs, DB writes | Already installed. `createSignedUploadUrl` + `uploadToSignedUrl` API confirmed. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `^4.4.3` (installed) | Schema for OCR output validation | Already installed. OCR schema uses same pattern as `MenuSeedSchema`. |
| `next/cache` | built-in | `revalidatePath()` | Already used in Phase 9/10. Call after DB writes. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `generateText` + `Output.object` | `generateObject` (deprecated) | `generateObject` still works in 6.0.175 but is marked deprecated in migration guide. Using `generateText` + `Output.object` is future-proof. However, Phase 9 code uses `generateObject` without issues — planner may keep consistency. Both are valid. |
| `openai('gpt-4.1-mini')` (Responses API) | `openai.chat('gpt-4.1-mini')` (Chat API) | Responses API is default in AI SDK v5+. Both accept vision input. Responses API preferred unless Chat API compatibility is explicitly required. |
| `uploadToSignedUrl` via Supabase client | Plain `fetch` PUT to `signedUrl` | `uploadToSignedUrl` requires the Supabase anon client on the browser. Plain `fetch` PUT is simpler but requires the `signedUrl` to be passed to the client (not just the token). Context.md says "returns `{ uploadUrl, storagePath }`" — so the signed URL is returned. Either method works; `uploadToSignedUrl` is more idiomatic. |

**Installation (Plan 01):**
```bash
npm install @ai-sdk/openai
```

**Version verification (confirmed 2026-05-07):**
```
@ai-sdk/openai: 3.0.62 (matches @ai-sdk/google@3.0.67 major)
```

---

## Architecture Patterns

### Recommended Project Structure

New files to add:
```
src/app/api/superadmin/tenants/[id]/
├── ocr-upload-token/
│   └── route.ts         # GET → returns { uploadUrl, storagePath }
└── ocr-process/
│   └── route.ts         # POST { storagePath, menuId } → download + OCR + DB write
src/lib/ai/
└── schemas.ts           # Add OcrMenuSchema (new export)
```

Modified files:
```
src/app/(superadmin)/tenants/[id]/
├── TenantDetailClient.tsx   # Add OCR sub-section after Image Seeding block
└── page.tsx                 # (if needed for prop wiring)
.env.example                 # Add OPENAI_API_KEY
```

### Pattern 1: Supabase Storage Signed Upload URL (AI-10)

**What:** Server generates a signed upload URL; client uploads directly to Storage without routing through Vercel.

**When to use:** Always for file uploads that may exceed 4.5 MB on Vercel serverless.

**GET /api/superadmin/tenants/[id]/ocr-upload-token:**
```typescript
// Source: Supabase JS SDK docs + CONTEXT.md D-01
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const timestamp = Date.now()
  const storagePath = `${tenantId}/ocr/${timestamp}-menu.jpg`  // extension determined by client filename

  const service = await createServiceClient()
  const { data, error } = await service.storage
    .from('tenant-assets')
    .createSignedUploadUrl(storagePath)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // data = { signedUrl, token, path }
  return NextResponse.json({ uploadUrl: data.signedUrl, storagePath: data.path })
}
```

**Client-side upload (in TenantDetailClient.tsx):**
```typescript
// Source: Supabase docs + CONTEXT.md D-01 flow
// Step 1: get token
const tokenRes = await fetch(`/api/superadmin/tenants/${tenant.id}/ocr-upload-token`)
const { uploadUrl, storagePath } = await tokenRes.json()

// Step 2: upload directly to Supabase Storage via PUT (bypasses Vercel)
await fetch(uploadUrl, {
  method: 'PUT',
  body: file,                          // File from input[type="file"]
  headers: { 'Content-Type': file.type },
})

// Step 3: trigger OCR processing
const processRes = await fetch(`/api/superadmin/tenants/${tenant.id}/ocr-process`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ storagePath, menuId: selectedMenuId }),
})
```

**Note on extension:** The storage path should use the actual file extension from `file.name.split('.').pop()` for correct MIME handling, or just store as-is and let Supabase infer. For OCR the extension does not affect GPT-4.1-mini's ability to process the image.

### Pattern 2: AI SDK v6 Vision + Structured Output (AI-11)

**What:** Download image from Storage as Buffer → pass to GPT-4.1-mini via `generateText` + `Output.object` with an image content part.

**When to use:** Any structured OCR extraction from images.

**POST /api/superadmin/tenants/[id]/ocr-process:**
```typescript
// Source: ai-sdk.dev/providers/ai-sdk-providers/openai + ai-sdk.dev/docs/foundations/prompts
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const OcrMenuSchema = z.object({
  categories: z.array(z.object({
    name: z.string(),
    products: z.array(z.object({
      name: z.string(),
      price: z.number(),
      description: z.string().nullable().optional(),
    })),
  })),
})

// Inside route handler:
const service = await createServiceClient()

// Download image from Storage (returns Blob-like)
const { data: blobData, error: dlErr } = await service.storage
  .from('tenant-assets')
  .download(storagePath)

if (dlErr || !blobData) throw new Error(`Storage download failed: ${dlErr?.message}`)

// Convert Blob → Buffer for AI SDK image part
const imageBuffer = Buffer.from(await blobData.arrayBuffer())

const { output, usage } = await generateText({
  model: openai('gpt-4.1-mini'),
  output: Output.object({ schema: OcrMenuSchema }),
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Extract all menu categories, item names, prices, and descriptions from this menu photo.
Return ONLY valid JSON. Rules:
- category "name": the section header exactly as printed
- product "name": the item name exactly as printed
- product "price": numeric only (e.g. 32.00). Brazilian locale: replace comma with dot (32,50 → 32.50). Price ranges: use the lower value. Unreadable price: use 0.
- product "description": the printed description text, or null if not visible. Do NOT hallucinate descriptions.
Return all categories and all items you can read. Do not skip items.`,
        },
        {
          type: 'image',
          image: imageBuffer,
        },
      ],
    },
  ],
})

// output is the typed OcrMenuSchema result
const totalTokens = usage?.totalTokens ?? 0
```

### Pattern 3: Additive DB Write (matches Phase 9 D-07 / D-08)

**What:** For each category in OCR output, find or create the category by name (case-insensitive). For each product, skip if already exists in that category.

```typescript
// Source: Phase 9 seed/route.ts pattern — proven additive insert
const { data: existingCats } = await service
  .from('categories')
  .select('name, id')
  .eq('tenant_id', tenantId)
  .eq('menu_id', menuId)

const existingCatMap = new Map(
  (existingCats ?? []).map(c => [c.name.toLowerCase().trim(), c.id])
)

// For each OCR category:
//   Look up in existingCatMap first (case-insensitive trim)
//   If not found → insert → get new ID
//   Then for each product: check existingProdNames, skip if duplicate
```

### Pattern 4: ai_usage Logging (matches Phase 9/10)

```typescript
// Source: seed/route.ts non-blocking logging pattern
try {
  const today = new Date().toISOString().slice(0, 10)
  await service.from('ai_usage').upsert({
    tenant_id: tenantId,
    feature_key: 'ocr_menu',   // ← new feature_key for Phase 11
    date: today,
    call_count: 1,
    token_count: totalTokens,
  }, { onConflict: 'tenant_id,feature_key,date' })
} catch (e) {
  console.error('[ai_usage] non-blocking log failed:', e)
}
```

### Pattern 5: UI OCR Sub-section (matches Phase 10 Image Seeding pattern)

**What:** New sub-section in `TenantDetailClient.tsx` after the Image Seeding `<div>` block.

```typescript
// State to add:
const [ocrLoading, setOcrLoading] = useState(false)
const [ocrStatus, setOcrStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
const [ocrFile, setOcrFile] = useState<File | null>(null)
const [ocrFileSizeWarning, setOcrFileSizeWarning] = useState(false)

// Handler:
async function handleOcrUpload() {
  if (!ocrFile || !selectedMenuId) return
  setOcrLoading(true)
  setOcrStatus(null)
  try {
    // Step 1: get signed URL
    const tokenRes = await fetch(`/api/superadmin/tenants/${tenant.id}/ocr-upload-token`)
    const { uploadUrl, storagePath } = await tokenRes.json()
    // Step 2: upload directly to Storage
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: ocrFile,
      headers: { 'Content-Type': ocrFile.type || 'image/jpeg' },
    })
    if (!uploadRes.ok) throw new Error('Storage upload failed')
    // Step 3: process
    const processRes = await fetch(`/api/superadmin/tenants/${tenant.id}/ocr-process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath, menuId: selectedMenuId }),
    })
    const data = await processRes.json()
    if (!processRes.ok) throw new Error(data.error ?? 'OCR failed')
    setOcrStatus({
      type: 'success',
      message: `${data.categoriesCreated} categories and ${data.productsCreated} products extracted.`,
    })
  } catch (err) {
    setOcrStatus({ type: 'error', message: err instanceof Error ? err.message : 'OCR failed' })
  }
  setOcrLoading(false)
}
```

### Anti-Patterns to Avoid

- **Passing the photo through the Vercel route body:** Direct POST of a file to `/api/.../ocr-process` would fail for photos > 4.5 MB. The signed URL pattern is mandatory (D-01, PITFALLS.md Pitfall 4).
- **Converting photo to WebP before OCR:** The `convertBufferToWebP` utility from Phase 10 must NOT be used here. Original JPEG/PNG is what GPT-4.1-mini vision reads. (Context.md explicit note.)
- **Using `generateObject` with `prompt:` string for vision:** `generateObject` accepts `messages` with image content parts, but the v6-preferred pattern is `generateText` + `Output.object`. Both work; `generateText` + `Output.object` is consistent with the SDK's direction.
- **Hallucinated descriptions:** Prompt must explicitly say "leave description null if not visible on the menu."
- **Mixing `@ai-sdk/openai@2.x` with `ai@6.x`:** The major version must be `^3`. Installing `@ai-sdk/openai` without pinning to `^3` could pick up an incompatible version if npm resolves an older cache.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signed upload URL generation | Custom presigned URL logic | `service.storage.from('tenant-assets').createSignedUploadUrl(path)` | Supabase handles token expiry (2 hours), HMAC signing, path scoping |
| Image → Buffer conversion | Custom FileReader / fetch pipeline | `Buffer.from(await blobData.arrayBuffer())` (Supabase download → arrayBuffer → Buffer) | One-liner from confirmed Node.js pattern |
| Structured OCR output validation | Custom JSON.parse with try/catch | `Output.object({ schema: OcrMenuSchema })` in `generateText` | AI SDK handles retry, schema enforcement, model error propagation |
| Price locale normalization | Custom regex on string prices | GPT-4.1-mini instruction: "return numeric only; Brazilian locale: replace comma with dot" | Model handles locale-aware parsing; `price: 0` fallback covers failures (D-11/12) |
| Category/product deduplication | N+1 SELECT per item | Fetch all existing names upfront → Set/Map lookup | Matches proven Phase 9 pattern; avoids query explosion for large menus |

**Key insight:** The entire Phase 11 is composition of existing Supabase Storage APIs and AI SDK APIs. Every individual problem has a solved library answer.

---

## Key Technical Findings

### 1. GPT-4.1-mini Model String

**Confirmed model ID:** `gpt-4.1-mini`

The API model string is literally `gpt-4.1-mini` (not `gpt-4o-mini`, not `gpt-4.1-mini-2025-04-14`).

- Released: April 14, 2025
- Context window: 1,047,576 tokens (1M+)
- Max output: 32,768 tokens
- Supports: vision (image input), structured output, function calling
- The dated snapshot `gpt-4.1-mini-2025-04-14` also works but `gpt-4.1-mini` resolves to the current snapshot.
- Source: [OpenAI API docs — GPT-4.1-mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

**Confidence: HIGH** (official OpenAI API docs)

### 2. `@ai-sdk/openai` Installation

**Not installed** — confirmed by checking `node_modules/@ai-sdk/` which only contains `gateway`, `google`, `provider`, `provider-utils`.

**Install command:**
```bash
npm install @ai-sdk/openai
```

**Version to install:** `3.0.62` (latest as of 2026-05-07). The `^3` range matches the major version of all other `@ai-sdk/*` packages in the project (`@ai-sdk/google@3.0.67`).

**Peer dependency:** `zod: "^3.25.76 || ^4.1.8"` — compatible with the project's `zod@^4.4.3`.

**Confidence: HIGH** (confirmed via `node_modules` inspection + npm registry)

### 3. AI SDK v6 Image Input API

`generateText` (or `generateObject`, still available) accepts `messages` with image content parts:

```typescript
messages: [{
  role: 'user',
  content: [
    { type: 'text', text: '...' },
    { type: 'image', image: bufferOrUrlOrBase64 },
  ],
}]
```

The `image` field accepts: `Buffer`, `Uint8Array`, `ArrayBuffer`, URL string, URL object, base64 string, data URL string.

For Phase 11: Download blob from Supabase Storage → `Buffer.from(await blob.arrayBuffer())` → pass as `image` field.

**`generateObject` status:** Still exported and functional in `ai@6.0.175` (confirmed by searching `node_modules/ai/dist/index.js`). The AI SDK 6 migration guide calls it "deprecated" but it is NOT removed. Planner may use either approach — `generateText` + `Output.object` is preferred for forward-compatibility.

**Confidence: HIGH** (official AI SDK docs + local node_modules inspection)

### 4. Supabase Storage `createSignedUploadUrl`

**Server-side (service client):**
```typescript
const { data, error } = await service.storage
  .from('tenant-assets')
  .createSignedUploadUrl(storagePath)
// data = { signedUrl: string, token: string, path: string }
```

Returns `{ data: { signedUrl, token, path }, error }`. The token is valid for 2 hours.

**Client-side upload option A (Supabase SDK):**
```typescript
const anonSupabase = createBrowserClient(...)  // requires anon key on client
await anonSupabase.storage.from('tenant-assets').uploadToSignedUrl(path, token, file)
```

**Client-side upload option B (plain fetch — preferred for this project):**
```typescript
await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
```

**Recommendation:** Use plain `fetch` PUT. The project does not have a client-side Supabase instance set up for storage (TenantDetailClient.tsx uses server-fetched data). Return `signedUrl` (not just `token`) from the token endpoint. The client uses plain fetch PUT — no Supabase SDK import needed on the client.

**Confidence: HIGH** (Supabase official docs + Medium example + CONTEXT.md D-01)

### 5. Supabase Storage Server-Side Download

**Pattern to download OCR image on the server before passing to GPT:**
```typescript
const { data: blobData, error: dlErr } = await service.storage
  .from('tenant-assets')
  .download(storagePath)
// blobData is a Blob
const imageBuffer = Buffer.from(await blobData.arrayBuffer())
```

**Confidence: HIGH** (official Supabase JS docs + confirmed blog example)

### 6. `openai()` vs `openai.chat()` Model Syntax

Both `openai('gpt-4.1-mini')` and `openai.chat('gpt-4.1-mini')` work. The default `openai()` uses the Responses API (default since AI SDK v5). `openai.chat()` targets the Chat Completions API. Both support vision input.

**Use `openai('gpt-4.1-mini')`** — simpler, uses Responses API, supported by official docs examples.

**Confidence: HIGH** (ai-sdk.dev OpenAI provider docs)

---

## Common Pitfalls

### Pitfall 1: Vercel 4.5 MB Body Limit (MANDATORY bypass)
**What goes wrong:** If the client POSTs the image file to any `/api/...` Next.js route, Vercel rejects requests > 4.5 MB with a 413 error.
**Why it happens:** Vercel serverless has a hard 4.5 MB request body limit.
**How to avoid:** The signed URL two-step is mandatory. Never send the image file through a Next.js API route. (Already locked in D-01.)
**Warning signs:** 413 errors in production for large mobile phone photos (8-15 MB).

### Pitfall 2: `generateObject` with Zod v4 Schema and Vision
**What goes wrong:** `generateObject` may fail schema validation for complex nested schemas when using vision models (GPT can return slightly inconsistent formats).
**Why it happens:** Vision models produce less structured output than text-only models. Complex nested Zod schemas may reject valid-but-imperfect GPT output.
**How to avoid:** Keep the OCR schema flat/shallow. Make `description` nullable/optional. Add `.optional()` to price. Use `z.number()` not `z.number().positive()` (price 0 must be allowed). Test with edge-case menus (single category, no prices).
**Warning signs:** Schema validation errors in server logs; empty categories array returned.

### Pitfall 3: Price as String Instead of Number
**What goes wrong:** GPT-4.1-mini returns `"32,50"` (Brazilian locale string) instead of `32.50` (number).
**Why it happens:** Without explicit instruction, the model echoes the printed format.
**How to avoid:** Prompt must explicitly say: "return price as a number only (e.g. 32.00). Brazilian locale: replace comma with dot (32,50 → 32.50). Unreadable: return 0." The Zod schema uses `z.number()` which will fail on a string — this triggers schema rejection, not a graceful `price: 0`.
**Warning signs:** Schema validation errors with "Expected number, received string".

### Pitfall 4: `@ai-sdk/openai` Version Mismatch
**What goes wrong:** Installing `@ai-sdk/openai@2.x` (older major) with `ai@6.x` causes peer dependency conflicts and runtime errors.
**Why it happens:** AI SDK major versions are tightly coupled. `ai@6.x` requires `@ai-sdk/*@^3.x`.
**How to avoid:** `npm install @ai-sdk/openai` (without pinning) installs the latest `3.x`. Verify post-install: `npm list @ai-sdk/openai` should show `3.x`.
**Warning signs:** `npm install` warnings about peer dependency conflicts.

### Pitfall 5: Missing `OPENAI_API_KEY` at Runtime
**What goes wrong:** `@ai-sdk/openai` throws at import or at `openai('gpt-4.1-mini')` call if `OPENAI_API_KEY` is not set.
**Why it happens:** The provider reads the env var at initialization.
**How to avoid:** Add `OPENAI_API_KEY=your-key` to `.env.local` AND document in `.env.example`. Plan 01 must include this step.
**Warning signs:** `Error: OpenAI API key is missing` or similar at route startup.

### Pitfall 6: Using WebP Conversion for OCR Images
**What goes wrong:** Converting the OCR photo to WebP (using `convertBufferToWebP` from `src/lib/upload.ts`) adds latency and is unnecessary.
**Why it happens:** Phase 10 uses WebP conversion for display images; a developer might copy that pattern.
**How to avoid:** OCR uploads skip the WebP conversion pipeline. Pass original JPEG/PNG Buffer to GPT-4.1-mini. (Explicitly noted in CONTEXT.md specifics.)
**Warning signs:** Unnecessary `sharp` processing in the OCR route.

### Pitfall 7: Storage Path Extension Mismatch
**What goes wrong:** The token endpoint generates a path with `.jpg` extension but the uploaded file is a `.png`. Supabase allows this but it may confuse MIME type handling.
**Why it happens:** Extension is generated server-side before knowing the file type.
**How to avoid:** The token endpoint can accept a `filename` query parameter from the client, or just omit the extension in the storage path (e.g., `{tenant_id}/ocr/{timestamp}`). Content-Type header on the PUT request is what matters for Supabase, not the extension.

### Pitfall 8: `assertSuperadmin()` Return Value
**What goes wrong:** Code does `if (!await assertSuperadmin()) return 401` — this is correct. But developers may accidentally use `isSuperadminRequest()` instead, which returns a boolean (not the client).
**Why it happens:** Two similar functions in `superadmin-auth.ts`.
**How to avoid:** Always use `assertSuperadmin()` in route handlers (returns null | supabase client). This is the pattern from all Phase 9/10 routes.

---

## Code Examples

### Complete OCR Schema (src/lib/ai/schemas.ts addition)

```typescript
// Source: OcrMenuSchema for Phase 11 — based on existing MenuSeedSchema pattern
// price: 0 is valid (D-12), description nullable (D-06)
export const OcrMenuSchema = z.object({
  categories: z.array(z.object({
    name: z.string(),
    products: z.array(z.object({
      name: z.string(),
      price: z.number(),                        // 0 = parsing failure (D-12)
      description: z.string().nullable().optional(),
    })),
  })),
})

export type OcrMenuResult = z.infer<typeof OcrMenuSchema>
```

### Storage Download + Buffer Conversion

```typescript
// Source: confirmed pattern from nesin.io/blog/download-file-supabase-storage-node
const { data: blobData, error: dlErr } = await service.storage
  .from('tenant-assets')
  .download(storagePath)

if (dlErr || !blobData) {
  return NextResponse.json({ error: `Storage download failed: ${dlErr?.message}` }, { status: 500 })
}

const imageBuffer = Buffer.from(await blobData.arrayBuffer())
```

### generateText + Output.object + Vision

```typescript
// Source: ai-sdk.dev/providers/ai-sdk-providers/openai + ai-sdk.dev/docs/foundations/prompts
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'

const { output: ocrResult, usage } = await generateText({
  model: openai('gpt-4.1-mini'),
  output: Output.object({ schema: OcrMenuSchema }),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: HARDCODED_SYSTEM_PROMPT },
        { type: 'image', image: imageBuffer },
      ],
    },
  ],
})
```

### Client-Side Two-Step Upload

```typescript
// Source: CONTEXT.md D-01 + Supabase Storage signed URL docs
// Step 1: get signed URL
const tokenRes = await fetch(`/api/superadmin/tenants/${tenant.id}/ocr-upload-token`)
if (!tokenRes.ok) throw new Error('Failed to get upload token')
const { uploadUrl, storagePath } = await tokenRes.json() as { uploadUrl: string; storagePath: string }

// Step 2: PUT directly to Supabase Storage (bypasses Vercel entirely)
const uploadRes = await fetch(uploadUrl, {
  method: 'PUT',
  body: ocrFile,                                // File from <input type="file">
  headers: { 'Content-Type': ocrFile.type || 'image/jpeg' },
})
if (!uploadRes.ok) throw new Error('Storage upload failed')

// Step 3: POST tiny payload to process route
const processRes = await fetch(`/api/superadmin/tenants/${tenant.id}/ocr-process`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ storagePath, menuId: selectedMenuId }),
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `generateObject(...)` | `generateText` + `Output.object({schema})` | AI SDK 6.0 | `generateObject` deprecated but NOT removed; both work in 6.0.175 |
| `openai.chat('model')` | `openai('model')` (Responses API default) | AI SDK 5+ | Simpler syntax; Responses API preferred |
| Pass image as base64 string | Pass as `Buffer` or `URL` directly | AI SDK 4.x+ | SDK handles encoding; Buffer from Node.js is cleanest server-side |

**Available in installed version (6.0.175):**
- `generateObject`: exported and functional (confirmed in node_modules)
- `Output`: exported from `ai` (confirmed in node_modules)
- `generateText` with `output: Output.object(...)`: supported

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@ai-sdk/openai` | OCR route — openai() model call | No (not installed) | — | None — must install (Plan 01) |
| `OPENAI_API_KEY` | @ai-sdk/openai provider init | Unknown — not in .env.example | — | None — must configure (Plan 01) |
| `ai` (SDK) | generateText, Output | Yes | 6.0.175 | — |
| `zod` | OcrMenuSchema | Yes | ^4.4.3 | — |
| `@supabase/supabase-js` | Storage signed URL + download | Yes | ^2.101.1 | — |
| `tenant-assets` bucket | OCR photo storage | Yes (used by Phase 9/10) | — | — |

**Missing dependencies with no fallback:**
- `@ai-sdk/openai`: must be installed in Plan 01 before any OCR route can work.
- `OPENAI_API_KEY`: must be set in `.env.local` and documented in `.env.example` in Plan 01.

---

## Project Constraints (from CLAUDE.md)

CLAUDE.md does not exist in the project root. Project conventions are derived from existing code patterns:

- All AI routes: `export const runtime = 'nodejs'` (Sharp + Gemini SDK require Node.js, OpenAI SDK also requires Node.js)
- `assertSuperadmin()` first in every new route; return 401 if null
- `tenant_id` always from URL param, never from request body
- Non-blocking `ai_usage` logging: wrapped in try/catch, never throws
- `revalidatePath()` after all DB writes complete
- Zod v4 schemas: `z.record` requires two args (`z.record(z.string(), z.any())`)
- No WebP conversion for OCR images (CONTEXT.md explicit)
- No draft/review pattern — direct writes to DB (REQUIREMENTS.md, CONTEXT.md)
- Additive inserts: case-insensitive name match before insert; never overwrite existing data

---

## Open Questions

1. **`openai('gpt-4.1-mini')` vs `openai.chat('gpt-4.1-mini')`**
   - What we know: Both work. Responses API is default in AI SDK v5+.
   - Recommendation: Use `openai('gpt-4.1-mini')`. If Responses API causes unexpected behavior (rare), fall back to `openai.chat('gpt-4.1-mini')`.

2. **Storage path extension handling**
   - What we know: Token endpoint generates path server-side. Client filename extension unknown at token-generation time.
   - Recommendation: Accept an optional `filename` query param in `GET /ocr-upload-token?filename=menu.jpg`, or omit extension entirely from the storage path.

3. **`generateObject` vs `generateText` + `Output.object` for vision**
   - What we know: Both work in 6.0.175. `generateObject` is deprecated per migration guide.
   - Recommendation: Use `generateText` + `Output.object` for forward-compatibility. Phase 9 uses `generateObject` (for consistency), but Phase 11 is a good place to adopt the v6 pattern.

4. **Single file or separate GET/POST routes**
   - What we know: Next.js supports multiple HTTP methods in one route file. Both patterns are valid.
   - Recommendation: Separate files (`ocr-upload-token/route.ts` and `ocr-process/route.ts`) for clarity and to keep `maxDuration = 60` scoped only to the process route.

---

## Sources

### Primary (HIGH confidence)
- [ai-sdk.dev — OpenAI Provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai) — model string syntax, vision example, `openai()` vs `openai.chat()`
- [ai-sdk.dev — Prompts foundations](https://ai-sdk.dev/docs/foundations/prompts) — image content part format (Buffer/URL/base64/Uint8Array)
- [OpenAI API docs — GPT-4.1-mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) — confirmed model ID `gpt-4.1-mini`, vision support
- [ai-sdk.dev — Migration guide 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) — `generateObject` deprecated; `@ai-sdk/*@^3` required for `ai@^6`
- Local `node_modules` inspection — confirmed `@ai-sdk/openai` not installed, `ai@6.0.175` installed, `Output` and `generateObject` both exported
- [Supabase JS Reference — storage-from-createsigneduploadurl](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl) — token, signedUrl, path return values
- [Supabase JS Reference — storage-from-uploadtosignedurl](https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl) — uploadToSignedUrl parameters

### Secondary (MEDIUM confidence)
- [ai-sdk.dev — Generate Object with Image Prompt example](https://ai-sdk.dev/examples/node/generating-structured-data/add-images-to-prompt) — `streamText` + `Output.object` with image messages pattern
- [nesin.io — Download file from Supabase Storage in Node.js](https://nesin.io/blog/download-file-supabase-storage-node) — `download()` → `arrayBuffer()` → `Buffer.from()` pattern
- [Medium — Signed URL uploads with NextJS and Supabase](https://medium.com/@olliedoesdev/signed-url-file-uploads-with-nextjs-and-supabase-74ba91b65fe0) — complete server/client flow example

### Tertiary (LOW confidence)
- None — all critical claims verified with primary sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@ai-sdk/openai@^3` confirmed from migration guide + npm; `ai@6.0.175` locally installed
- Architecture: HIGH — patterns derived from existing working Phase 9/10 code + official docs
- Pitfalls: HIGH — derived from official docs warnings, CONTEXT.md, and local code analysis
- GPT-4.1-mini model string: HIGH — confirmed from official OpenAI API docs

**Research date:** 2026-05-07
**Valid until:** 2026-06-07 (stable APIs; `@ai-sdk/openai` version may change but `^3` range remains correct)
