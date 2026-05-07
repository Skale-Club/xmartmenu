# Phase 10: Image Seeding — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Superadmin-only AI image seeding for tenant menus. Generates a restaurant cover/banner photo and per-product photos via **Nano Banana 2 (Google's Gemini 3 Pro Image)**, converts each output to WebP via the existing Sharp pipeline, and uploads to Supabase Storage as `tenant_settings.banner_url` and `products.image_url` respectively. Entry point: AI Tools section in `/(superadmin)/tenants/[id]` (already shipped in Phase 9).

No tenant-facing UI, no review screen, no stock photo libraries, no OpenAI image API.

</domain>

<decisions>
## Implementation Decisions

### Image Provider
- **D-01:** All images generated via **Nano Banana 2** (Google's Gemini 3 Pro Image), accessed through `@ai-sdk/google`. Cover photo and per-product photos use the same model.
- **D-02:** Reuses the existing `GOOGLE_GENERATIVE_AI_API_KEY` from Phase 9. No new provider, no OpenAI image API, no Pexels/Unsplash. Single AI vendor across v1.2 text + image (Phase 11 OCR is the only remaining OpenAI dependency).
- **D-03:** Supersedes Phase 9 09-CONTEXT.md D-04 ("Images (Phase 10) stay on `gpt-image-1-mini`") and the matching language in REQUIREMENTS.md AI-07 / AI-08 and ROADMAP.md Phase 10. Those upstream artifacts are updated in this phase.

### Scope
- **D-04:** Phase 10 ships:
  - Cover photo seeding (REQ AI-07): one image per tenant, written to `tenant_settings.banner_url`.
  - Per-product photo seeding (REQ AI-08): one image per product without an existing `image_url`, written to `products.image_url`.
  - Per-product targeting (REQ AI-09): superadmin can seed an image for a single product via the existing AI Tools selector.

### Call Pattern
- **D-05:** Sync, sequential. POSTs to the seed API await the underlying Nano Banana 2 call(s) inline. Bulk per-product seeding loops sequentially over products. `export const maxDuration = 300` on the image route (requires Vercel Pro).
- **D-06:** No `ai_image_jobs` table, no polling, no Realtime. Phase 9 sync pattern is preserved. If a future phase needs queueing, that's a separate decision.
- **D-07:** Per-product bulk seed scope: products in the selected menu where `image_url IS NULL`, in `position` order. The route returns once all calls complete (or the first hard error halts the loop and reports partial success).

### UI Placement
- **D-08:** All Phase 10 controls live inside the existing AI Tools section in `TenantDetailClient.tsx` — mirrors Phase 9. New controls:
  - "Seed cover" button (single image, additive — see D-11).
  - "Seed product images" button (bulk, scoped to the selected menu, additive — see D-13).
  - Category selector + product selector + "Seed image" button (single product, mirrors Phase 9's "Seed product" pattern).
- **D-09:** No separate Products tab. No expansion of TenantDetailClient layout beyond the AI Tools section. Loading/success/error banners reuse the Phase 9 `seedStatus` shape with messages adapted for image counts and longer durations.

### Prompt + Overwrite
- **D-10:** Cover prompt = sanitized `business_type` + sanitized `company_name`. No style hints, no menu-copy injection. Uses the same `sanitizeForPrompt()` from Phase 9.
- **D-11:** Cover is **additive** — if `tenant_settings.banner_url` is already set, skip. Superadmin clears the banner in the existing Branding UI to re-seed. No surprise overwrites.
- **D-12:** Per-product prompt = sanitized `business_type` + `product.name` + sanitized `product.description` (when present). All inputs pass through `sanitizeForPrompt()`.
- **D-13:** Per-product is additive — only seeds products where `image_url IS NULL`. Existing images are never overwritten.

### Storage + Pipeline
- **D-14:** Reuses the existing `tenant-assets` Supabase Storage bucket (already used by Branding for logo + banner uploads).
- **D-15:** Storage paths:
  - Cover: `{tenant_id}/banner.webp` (matches Branding upload convention; `upsert: true`).
  - Per-product: `{tenant_id}/products/{product_id}.webp` (`upsert: true` so a manual delete + re-seed works).
- **D-16:** WebP conversion via the existing Sharp pipeline at `src/lib/upload.ts`. Add a Buffer-input sibling (e.g., `convertBufferToWebP(buf: Buffer): Promise<Buffer>`) so Nano Banana 2's response bytes can be processed without going through `File`. Existing `validateAndConvertToWebP(file: File)` stays for upload routes.

### Cost + Safety
- **D-17:** `ai_usage` rows logged for every Nano Banana 2 call: `feature_key = 'image_cover' | 'image_product'`. Token/call counts incremented additively via the Phase 9 upsert pattern. Informational only, not a blocking gate (matches Phase 9 D-09).
- **D-18:** All prompt-bound strings (`business_type`, `company_name`, `product.name`, `product.description`) pass through `sanitizeForPrompt()` before interpolation. Pitfall 1 mitigation extends to image prompts.
- **D-19:** `revalidatePath()` called after every successful write to `tenant_settings.banner_url` or `products.image_url` so the public menu does not serve a stale ISR snapshot.

### Auth
- **D-20:** Every new route calls `assertSuperadmin()` first. `tenant_id` always derived from the URL param, never from the request body (matches Phase 9 + ARCHITECTURE.md guidance).

### Claude's Discretion
- The exact Nano Banana 2 model ID (`gemini-3-pro-image` vs `gemini-3-pro-image-preview` etc.) — researcher confirms at planning time against the live Google AI Studio model list for the current API key.
- Cover aspect ratio / dimensions (banner is `~3:1` per BrandingClient; planner picks the closest supported Nano Banana 2 ratio) and per-product photo dimensions (square preferred for product cards).
- Whether the seed image route is folded into the existing `src/app/api/superadmin/tenants/[id]/seed/route.ts` (new `type` values: `image_cover`, `image_products`, `image_single_product`) or split into a sibling `/seed-image` route — planner decides based on file size after Phase 9.
- Concurrency cap inside the sequential bulk loop (default sequential one-at-a-time; escalate only if rate limits force batching).
- Per-product progress reporting shape in the response payload (e.g., counts of created / skipped / failed) for the UI to display, mirroring Phase 9's `buildSuccessMessage`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing superadmin tenant UI
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — AI Tools section already exists; Phase 10 extends it
- `src/app/(superadmin)/tenants/[id]/page.tsx` — server component fetching tenant + menus

### Existing seed API route (pattern to follow / extend)
- `src/app/api/superadmin/tenants/[id]/seed/route.ts` — Phase 9 single-route pattern with `type` discriminator
- `src/app/api/superadmin/tenants/[id]/menus/[menuId]/categories-list/route.ts` — sibling route for per-item selectors

### Existing image / upload infrastructure
- `src/lib/upload.ts` — `validateAndConvertToWebP(file: File)`; needs a Buffer sibling in this phase
- `src/app/api/superadmin/tenants/[id]/upload/route.ts` — server-side upload to `tenant-assets` bucket; auth + storage pattern
- `src/app/(admin)/settings/branding/BrandingClient.tsx` — direct Supabase Storage upload pattern; banner 3:1 ratio reference

### Database tables (write targets)
- `supabase/migrations/001_initial_schema.sql` — `tenant_settings.banner_url`, `tenants.id`
- `supabase/migrations/019_full_schema_sync.sql` — `products.image_url` and `products.image_urls`
- `supabase/migrations/022_ai_usage.sql` — `ai_usage` schema (`feature_key, date, call_count, token_count`) — reused, no new migration
- `src/types/database.ts` — TypeScript types

### AI / sanitization (shared from Phase 9)
- `src/lib/ai/sanitize.ts` — `sanitizeForPrompt()` utility
- `src/lib/ai/schemas.ts` — Zod schemas (Phase 10 may add image-prompt input schemas)

### Auth / tenant isolation
- `src/lib/superadmin-auth.ts` — `assertSuperadmin()`

### Research artifacts
- `.planning/research/STACK.md` — AI SDK v6 + `@ai-sdk/google` patterns; image API note (was gpt-image-1-mini, **superseded by Nano Banana 2 in this phase**)
- `.planning/research/ARCHITECTURE.md` — Node.js runtime mandate for AI routes; existing Sharp pipeline reuse
- `.planning/research/PITFALLS.md` Pitfall 1 (prompt injection — `sanitizeForPrompt()` applies), Pitfall 3 (sync image generation blocks UX — **mitigated by sync-sequential + maxDuration=300 on Vercel Pro**)

### Roadmap + requirements (updated in this phase)
- `.planning/ROADMAP.md` Phase 10 — goal updated to remove Pexels/Unsplash and gpt-image-1-mini
- `.planning/REQUIREMENTS.md` AI-07 / AI-08 — model swapped to Nano Banana 2; stock photo language removed
- `.planning/PROJECT.md` Active v1.2 line — updated to drop Pexels/Unsplash and gpt-image-1-mini

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assertSuperadmin()` from `src/lib/superadmin-auth.ts` — guard every new route
- `sanitizeForPrompt()` from `src/lib/ai/sanitize.ts` — used for all interpolated tenant strings
- `tenant-assets` Supabase Storage bucket — reuse, no new bucket
- Existing `/seed` route at `src/app/api/superadmin/tenants/[id]/seed/route.ts` — extend with new `type` values (or sibling route — Claude's Discretion)
- `TenantDetailClient.tsx` AI Tools section — extend with cover + per-product image controls
- Phase 9 `seedStatus` / `perItemLoading` / `selectedCategoryId` patterns — reuse for image flow

### Established Patterns
- Single seed route with `type` field handles fan-out without route proliferation (Phase 9)
- `'use client'` Client component receives data as props from a server component
- `assertSuperadmin()` first; `tenant_id` from URL param; service client for writes
- After every menu-mutating write, `revalidatePath()` for ISR freshness
- `ai_usage` upsert pattern via `UNIQUE(tenant_id, feature_key, date)` (Phase 9)

### Integration Points
- New `/seed` route handlers (or new `type` cases inside the existing seed route)
- New helper module — likely `src/lib/ai/image.ts` — wraps the Nano Banana 2 call (sanitize → call → return image bytes + token count)
- New helper — likely `src/lib/ai/upload-image.ts` — Buffer → WebP → Supabase Storage path → return public URL
- New `convertBufferToWebP()` (or similar) sibling added to `src/lib/upload.ts`
- `TenantDetailClient.tsx` gains `seedCover`, `seedProductImages`, `seedSingleProductImage` handlers + UI controls
- `ai_usage` gets two new `feature_key` values: `image_cover`, `image_product`

</code_context>

<specifics>
## Specific Ideas

- All image generation goes through **Nano Banana 2** (Gemini 3 Pro Image). Do not use OpenAI / DALL-E / gpt-image / Pexels / Unsplash anywhere in this phase.
- The `validateAndConvertToWebP()` function in `src/lib/upload.ts` cannot be used as-is for AI-generated bytes (it takes `File`). Add a Buffer-input sibling rather than rewriting the original — keep existing upload routes untouched.
- Cover banner ratio is `3:1` per `BrandingClient.tsx` ("Appears just below the header in the menu. 3:1 ratio recommended").
- Per-product images on the public menu render in the product card; existing styling shows `object-cover`. Square is the safe default.
- Bulk product image seeding can be slow (10–30 products × 15–30s = up to ~15 min worst case). The UI loading hint must be scaled accordingly — Phase 9's "up to 20 seconds" line will mislead users; phrase like "may take several minutes — keep this tab open."

</specifics>

<deferred>
## Deferred Ideas

- Async job pattern (`ai_image_jobs` table + polling/Realtime) — only revisit if sync-sequential proves unworkable in production.
- Re-prompting / "regenerate" controls for a specific cover or product — Phase 10 ships single-shot generation; superadmin clears the image manually to retry.
- Image moderation / content safety check before storage — research raised it but v1.2 doesn't gate on it.
- Per-tenant or daily image generation cost cap — `ai_usage` is informational; rate-limit gating belongs in a later phase if costs surprise us.
- AI image generation for products that already have an image (replace) — additive-only is locked.
- Style controls / custom prompt overrides per tenant — Phase 10 prompt is fixed.
- Aspect-ratio / dimensions selector in the UI — Claude's Discretion picks defaults.

</deferred>

---

*Phase: 10-image-seeding*
*Context gathered: 2026-05-07*
