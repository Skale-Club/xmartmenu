# Phase 11: Menu Photo OCR — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Superadmin-only menu photo OCR. Superadmin uploads a photo of a tenant's physical menu from the AI Tools section; the photo goes directly to Supabase Storage (bypasses Vercel's 4.5 MB body limit); GPT-4.1-mini vision extracts categories, product names, prices, and descriptions; extracted data is written additively to the tenant's `categories` and `products` tables. No review screen — the regular admin UI is the correction surface.

</domain>

<decisions>
## Implementation Decisions

### Upload Architecture
- **D-01:** Upload bypasses Vercel's 4.5 MB serverless body limit using Supabase Storage signed URLs (PITFALLS.md Pitfall 4):
  1. Client calls `GET /api/superadmin/tenants/{id}/ocr-upload-token` — lightweight route that returns a signed Supabase Storage upload URL.
  2. Client uploads the photo file directly to Supabase Storage from the browser (bypasses Vercel entirely).
  3. Client calls `POST /api/superadmin/tenants/{id}/ocr-process` with `{ storagePath, menuId }` — tiny payload.
  4. Route handler downloads the image from Supabase Storage server-side, sends to GPT-4.1-mini vision, writes results to DB.
- **D-02:** Storage bucket for OCR uploads: `tenant-assets` (existing bucket, path pattern: `{tenant_id}/ocr/{timestamp}-{filename}`). Upsert not needed — each upload is unique.
- **D-03:** UI hint to superadmin: "Max ~4 MB recommended for best OCR results." (Supabase Storage accepts up to 50 MB, but large photos slow OCR; 4 MB is a practical UX cap, not a hard limit.)

### AI Provider
- **D-04:** GPT-4.1-mini for OCR — locked from Phase 9 D-04. Uses `@ai-sdk/openai` (not yet installed — Phase 11 Plan 01 installs it). Env var: `OPENAI_API_KEY`.
- **D-05:** Route uses `export const runtime = 'nodejs'` and `export const maxDuration = 60` (OCR is a single call; 60s is sufficient and matches the existing text seed route pattern).

### Extraction Scope
- **D-06:** GPT-4.1-mini extracts:
  - Category names (section headers on the physical menu)
  - Product names
  - Product prices (as a number, parsed to NUMERIC)
  - Product descriptions (if readable on the menu — left null when not present)
  - The prompt explicitly instructs: do not hallucinate descriptions; leave description null if not visible.
- **D-07:** Prompt output format: structured JSON array matching the DB shape:
  ```json
  {
    "categories": [
      {
        "name": "Pizzas",
        "products": [
          { "name": "Margherita", "price": 32.0, "description": "Tomato, mozzarella, basil" },
          { "name": "Calabresa", "price": 35.0, "description": null }
        ]
      }
    ]
  }
  ```

### Data Writing
- **D-08:** Additive only — same policy as Phase 9 D-07. Match by case-insensitive name trim. If a category with the same name already exists for the tenant+menu, use it. If a product with the same name already exists in that category, skip it. Safe to re-run without data loss.
- **D-09:** Write targets: `categories.name`, `products.name`, `products.price`, `products.description` (when extracted), `products.menu_id`, `products.tenant_id`. Position assigned incrementally (max existing + 1 per item).
- **D-10:** `revalidatePath()` called after all writes complete (matches Phase 9 D-10).

### Price Parsing
- **D-11:** Price parsing: GPT-4.1-mini is instructed to return numeric values only (e.g. `32.00`, not `"R$ 32,00"`). The prompt explicitly handles Brazilian locale (comma-decimal `32,50` → `32.50`), integer prices (`12` → `12.00`), and price ranges (`"from 15"` → `15.00` as the lower bound).
- **D-12:** Failed price parsing = `price: 0` in the JSON output. **No new DB column.** Price `0` on a product in the regular admin UI is the signal to the superadmin that this item needs manual price correction. This satisfies REQ AI-12 — no schema migration required.
- **D-13:** Products returned by GPT-4.1-mini with `price: 0` or `price: null` are inserted with `price = 0` (NOT NULL constraint satisfied). Superadmin edits the price in the admin product UI.

### UI Placement
- **D-14:** New "OCR" sub-section added to the existing AI Tools section in `TenantDetailClient.tsx`, after the Image Seeding sub-section. No new tabs. UI:
  - File input (accept `image/*`) + "Extract from photo" button
  - Loading state: "Reading menu — this may take 20–40 seconds..."
  - Success: "X categories and Y products extracted."
  - Error: API error message shown in the existing error banner pattern.
- **D-15:** File input is a standard `<input type="file" accept="image/*">`. No drag-and-drop (YAGNI for superadmin tool). Client validates file size client-side and shows warning if > 4 MB ("Large photos may take longer; results may vary").

### Safety
- **D-16:** `ai_usage` row logged after GPT-4.1-mini call: `feature_key = 'ocr_menu'`, `call_count = 1`, `token_count` from response usage. Non-blocking, matches Phase 9 D-09.
- **D-17:** The OCR image path (from Supabase Storage) is passed server-side — no tenant-supplied text enters the GPT-4.1-mini prompt beyond the image itself. `sanitizeForPrompt()` is not needed for the photo URL, but the prompt system text is hardcoded and never interpolates tenant strings.
- **D-18:** `assertSuperadmin()` on every new route (D-20 pattern from Phase 10). `tenant_id` always derived from URL param.

### Claude's Discretion
- Exact GPT-4.1-mini model string (`gpt-4.1-mini` or `gpt-4o-mini` — researcher confirms at planning time from the OpenAI model list; the AI SDK uses string model IDs).
- Whether the signed URL endpoint and OCR process endpoint are separate files or a single route with different HTTP methods (GET for token, POST for process). Planner decides based on Next.js route conventions.
- Position ordering strategy for categories/products extracted from the photo (e.g., extraction order preserved, or alphabetical).
- Whether to clean up the OCR photo from Supabase Storage after processing, or leave it (useful for debugging). Default: leave it.
- Exact prompt engineering for GPT-4.1-mini vision — the structured JSON format, handling of multi-column layouts, price range disambiguation.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing superadmin tenant UI
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — AI Tools section; OCR sub-section appended after Image Seeding
- `src/app/(superadmin)/tenants/[id]/page.tsx` — server component; OCR controls follow same prop pattern

### Existing upload infrastructure (pattern to extend)
- `src/app/api/superadmin/tenants/[id]/upload/route.ts` — server-side Supabase Storage upload pattern (auth + storage)
- `src/lib/upload.ts` — `validateAndConvertToWebP`, `convertBufferToWebP`; OCR upload does NOT convert to WebP (keep original for vision API)

### Existing seed routes (auth + ai_usage + revalidatePath patterns)
- `src/app/api/superadmin/tenants/[id]/seed/route.ts` — text seed; auth guard, ai_usage upsert pattern
- `src/app/api/superadmin/tenants/[id]/seed-image/route.ts` — image seed; `runtime = 'nodejs'`, `maxDuration`, ai_usage

### Database (write targets)
- `supabase/migrations/001_initial_schema.sql` — `categories` and `products` table schemas
- `supabase/migrations/019_full_schema_sync.sql` — `products.image_url`, `menu_id` on categories+products
- `src/types/database.ts` — TypeScript types
- **No new migration needed for Phase 11** — `price = 0` covers AI-12, no new columns

### Auth / tenant isolation
- `src/lib/superadmin-auth.ts` — `assertSuperadmin()`

### Research artifacts (v1.2 roadmap)
- `.planning/research/PITFALLS.md` Pitfall 4 — Vercel 4.5 MB body limit bypass (MANDATORY: use signed URL pattern)
- `.planning/research/PITFALLS.md` Pitfall 5 — OCR auto-commits without human review (SUPERSEDED by REQUIREMENTS.md decision: direct writes are intentional; review happens in admin UI)
- `.planning/research/STACK.md` — `@ai-sdk/openai` (NOT yet installed, Plan 01 must install it); GPT-4.1-mini vision model

### Requirements
- `.planning/REQUIREMENTS.md` AI-10, AI-11, AI-12 — exact acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assertSuperadmin()` — auth guard for all new routes
- `createServiceClient()` — service-role Supabase client for DB writes and Storage operations
- `ai_usage` upsert pattern from `seed/route.ts` — copy for `feature_key = 'ocr_menu'`
- `revalidatePath()` pattern from Phase 9/10 routes
- `TenantDetailClient.tsx` AI Tools section structure — append new sub-section, reuse `seedLoading` disable pattern

### Established Patterns
- File input `<input type="file" accept="image/*">` + button — standard HTML, no special component needed
- Two-step upload: client calls signed URL route → uploads directly → POSTs storage path
- `assertSuperadmin()` first; `tenant_id` from URL param
- Additive inserts via name-match check before insert

### Integration Points
- New route: `GET /api/superadmin/tenants/[id]/ocr-upload-token` — returns `{ uploadUrl, storagePath }`
- New route: `POST /api/superadmin/tenants/[id]/ocr-process` — receives `{ storagePath, menuId }`, downloads image, calls GPT-4.1-mini, writes DB
- `TenantDetailClient.tsx` gets new state `ocrLoading`, `ocrStatus`, file handler `handleOcrUpload`
- `ai_usage` gets new `feature_key: 'ocr_menu'`
- `@ai-sdk/openai` installed in Plan 01 alongside `OPENAI_API_KEY` env var documentation

</code_context>

<specifics>
## Specific Ideas

- **Two-step flow is mandatory** (not optional): direct file upload to `/api/.../ocr-process` would hit the Vercel 4.5 MB body limit for photos from modern phones. The signed URL approach is the only viable architecture on Vercel.
- **No WebP conversion** for OCR uploads — the original JPEG/PNG is what GPT-4.1-mini vision reads; converting to WebP before sending would add latency and is unnecessary.
- **`price = 0` as the failure signal** is intentional and REQ-aligned. No new DB column. When superadmin sees a $0 product in the admin UI, they know it needs a price fix.
- **STATE.md note (v1.2 Roadmap): "ocr-menu returns draft, ocr-commit writes only after user confirmation"** — this was an early roadmap draft decision that was superseded by REQUIREMENTS.md ("no review screen, direct-to-DB"). Do not implement a draft/commit two-route pattern; use direct writes.
- Supabase Storage signed URL for OCR upload: use `service.storage.from('tenant-assets').createSignedUploadUrl(storagePath)` — returns `{ signedUrl, token, path }`.

</specifics>

<deferred>
## Deferred Ideas

- Review screen before committing OCR output — explicitly out of scope (REQUIREMENTS.md)
- Multiple photo uploads per OCR run — Phase 11 is single-photo; multi-page menus require multiple OCR runs
- Handwritten menu OCR (low-quality photo enhancement) — deferred in REQUIREMENTS.md future list
- Price range support (`"from R$15"` — store as `15.00` lower bound only, same as parse failure = 0 if unresolvable)
- Image compression client-side before upload — YAGNI for superadmin tool; hint "keep under 4 MB" is sufficient
- OCR photo cleanup from Storage after processing — leave it (useful for debugging); can be added later

</deferred>

---

*Phase: 11-menu-photo-ocr*
*Context gathered: 2026-05-07*
