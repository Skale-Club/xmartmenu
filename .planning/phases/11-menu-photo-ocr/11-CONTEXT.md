# Phase 11: Menu Photo OCR — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Superadmin-only menu photo OCR for tenant menus. The superadmin uploads a photo of a tenant's physical menu directly to Supabase Storage (bypassing Vercel's 4.5 MB body limit). The Vercel API route then sends the image to GPT-4.1-mini vision, parses the structured response (categories + items + prices), and writes the result directly to the tenant's `categories` and `products` tables.

The tenant never sees AI buttons. Corrections to OCR errors are made through the regular admin UI (no separate review screen).

</domain>

<decisions>
## Implementation Decisions

### Carrying Forward (locked in REQUIREMENTS.md / Phase 9 CONTEXT)

- **Superadmin-only:** Same model as Phases 9 and 10 (D-01 from Phase 9). Tenants never see AI generation buttons.
- **UI placement:** "OCR menu" upload control added to the existing AI Tools section in `/(superadmin)/tenants/[id]` (D-02 from Phase 9). No new route.
- **LLM provider:** GPT-4.1-mini vision via OpenAI API (REQUIREMENTS AI-11 / Phase 9 D-04). Not Gemini.
- **Upload pattern:** Direct browser → Supabase Storage signed URL → API route receives only `{ storage_path }` payload (REQUIREMENTS AI-10, PITFALLS.md Pitfall 4). The Vercel function never receives the raw image body.
- **Storage location:** `tenant-assets/{tenantId}/ocr/{uuid}.jpg` (or original extension). Same bucket as Phase 10 image seeding to avoid bucket sprawl.
- **Direct DB write:** No review/staging screen. Extracted categories and products are written directly to the tenant's `categories` and `products` tables (REQUIREMENTS "Out of Scope: Review then commit"). Corrections via the regular admin UI.
- **Additive only:** Skip categories/products that already exist by exact name match (Phase 9 D-07). Safe to run multiple times.
- **Failed price handling:** OCR-extracted prices that fail parsing (unrecognized format, missing currency, ambiguous decimal) are saved as `0` (REQUIREMENTS AI-12). Superadmin fixes them in the regular admin UI afterward.
- **Sanitize prompt inputs:** Apply `sanitizeForPrompt()` from `src/lib/ai/sanitize.ts` to `business_type`, `company_name`, and any tenant string interpolated into the OCR system prompt (Phase 9 D-11).
- **Revalidate after writes:** Call `revalidatePath()` on the tenant's public menu paths after OCR commits new data (Phase 9 D-10).
- **AI usage tracking:** Log a row in `ai_usage` with `feature_key: 'menu_ocr'`, `call_count: 1` per processed photo (Phase 9 D-09). Informational only — not a blocking gate.

### Multi-photo / Multi-page Handling
- **D-01:** Upload one photo at a time. The UI accepts a single file per OCR session. Multi-page menus are handled by uploading pages one after another — each upload is an independent OCR request that writes its results to the DB before the next upload.
  - Reasoning: simplest MVP, lets the additive D-07 rule naturally dedup overlapping page headers (e.g., "Pizzas" appearing on two pages).
  - Tradeoff: more clicks for multi-page menus, but less complexity than batch processing.
- **D-02:** Each photo is its own self-contained OCR call. No cross-photo state, no session/draft accumulation. The UI simply shows the per-call result (counts of categories added + products added + errors) and lets the user upload the next page.

### Processing Model
- **D-03:** Synchronous processing. The client POSTs `{ storage_path }` to `/api/superadmin/tenants/[id]/ocr` (or similar) and waits with a loading spinner for the full ~10-30s OCR round-trip. The route returns `{ category_count, product_count, errors }` directly.
  - Reasoning: GPT-4.1-mini vision finishes well within Vercel's 300s Pro plan limit; no need for the GH Actions / `ai_jobs` polling pattern from Phase 10.
  - The Vercel route uses `runtime: 'nodejs'` and `maxDuration: 60` (or up to 300 if needed). No background job system for this phase.

### Claude's Discretion (planner decides)

- **Price locale parsing strategy:** Default to pt-BR (`R$12,50` with comma as decimal). Pass `business_type` + tenant's primary language as hints to the OCR prompt so the LLM can adjust for European Portuguese (`€12.50`) or other locales when applicable. On parse failure, save as `0` per AI-12.
- **Extraction scope:** Extract category name, product name, product price, and product description (when visible). Do NOT attempt to crop product images from the photo — that would require image segmentation outside this phase's scope. Image generation for products stays in Phase 10's flow.
- **Client-side image preprocessing:** Resize the photo client-side to ~2MP (e.g., 1920×1080 max) using `canvas.toBlob()` if the original is larger than 3 MB. Skip resize for smaller photos. Reduces upload time + improves OCR consistency (PITFALLS.md Pitfall 4 recommendation).
- **OCR prompt structure:** Planner decides the exact system prompt + JSON schema for GPT-4.1-mini. Should request structured output `{ categories: [{ name, products: [{ name, description?, price_raw, price_parsed }] }] }` so the API route can apply the additive write rule cleanly.
- **API route structure:** Single `/api/superadmin/tenants/[id]/ocr` route or split into `ocr-upload-token` (sign URL) + `ocr-process` (do OCR). Planner decides based on existing Phase 10 pattern.
- **Client UI control:** File input + "Process menu" button placement within the AI Tools section — planner decides exact layout.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing superadmin tenant UI (Phase 11 UI extends this)
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — existing tenant detail client; "OCR menu" upload control goes here in the AI Tools section
- `src/app/(superadmin)/tenants/[id]/page.tsx` — server component; passes tenant data as props

### Existing superadmin API routes (patterns to follow)
- `src/app/api/superadmin/tenants/[id]/seed/route.ts` — Phase 9 text-seed route; same auth + sanitize + revalidate pattern
- `src/app/api/superadmin/tenants/[id]/seed-images/route.ts` — Phase 10 trigger route; signed URL upload pattern starts here
- `src/app/api/superadmin/tenants/[id]/upload/route.ts` — existing tenant-assets upload (storage path conventions)

### AI infrastructure (reused from Phase 9)
- `src/lib/ai/sanitize.ts` — `sanitizeForPrompt()`; apply to all tenant strings before LLM interpolation
- `src/lib/superadmin-auth.ts` — `assertSuperadmin()` guard for every new route

### Database (write targets)
- `supabase/migrations/019_full_schema_sync.sql` — canonical schema for `categories` and `products` tables
- `src/types/database.ts` — TypeScript types for `categories`, `products`, `ai_usage`

### Research artifacts (read for implementation details)
- `.planning/research/PITFALLS.md` §Pitfall 4 (4.5 MB Vercel limit / signed URL pattern)
- `.planning/research/PITFALLS.md` §Pitfall 5 (warns against direct commit — user explicitly overrode this; design must compensate with strong additive matching and clear error reporting)
- `.planning/research/PITFALLS.md` §Pitfall 6 (price locale ambiguity — Brazilian R$ vs European €)
- `.planning/research/STACK.md` — OpenAI SDK version, vision API call structure
- `.planning/research/ARCHITECTURE.md` — route runtime/timeout strategy, Sharp pipeline reuse

### Storage
- Supabase Storage `tenant-assets` bucket — used for both Phase 10 (cover/products) and Phase 11 (OCR uploads). New folder `{tenantId}/ocr/` for the input photos.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assertSuperadmin()` (`src/lib/superadmin-auth.ts`) — guards every new API route
- `sanitizeForPrompt()` (`src/lib/ai/sanitize.ts`) — apply to all tenant strings before LLM interpolation
- `validateAndConvertToWebP()` (`src/lib/upload.ts`) — Sharp pipeline (NOT needed for OCR — input is JPG/PNG, no conversion)
- Supabase service client + signed-URL upload pattern (already used in Phase 10 image seeding)
- `revalidatePath()` usage pattern (Phase 9 seed route)
- `ai_usage` insert pattern (Phase 9)

### Established Patterns
- Superadmin API routes: `assertSuperadmin()` → extract `tenantId` from URL param → service client → sanitize tenant strings → call AI → write DB → log usage → revalidate → respond
- Server components fetch data; pass as props to `*Client.tsx` with `'use client'`
- AI Tools section in `TenantDetailClient.tsx` already exists from Phase 9 + Phase 10 — Phase 11 adds a third subsection here

### Integration Points
- New API route(s) under `src/app/api/superadmin/tenants/[id]/ocr-*` (planner decides single or split)
- `TenantDetailClient.tsx` gains an "OCR menu" upload control + result display in the AI Tools section
- New row pattern in `ai_usage` with `feature_key: 'menu_ocr'`
- New folder convention in `tenant-assets/{tenantId}/ocr/` for OCR input photos

### Constraints
- OpenAI SDK is NOT yet a project dependency — Phase 11 adds it (or uses `fetch` directly to OpenAI's API). Planner decides.
- `OPENAI_API_KEY` env var must be added to Vercel + `.env.example`. Distinct from `GOOGLE_GENERATIVE_AI_API_KEY` used in Phases 9 and 10.

</code_context>

<specifics>
## Specific Ideas

- Default locale for price parsing: pt-BR (Brazilian Portuguese). The OCR prompt should pass `business_type` and tenant primary language as hints so the LLM adjusts for cardápios em European Portuguese, English, etc.
- Resize threshold for client-side preprocessing: 3 MB → resize to ~2MP (1920×1080). Below 3 MB → upload as-is.
- Per-photo result UI: show counts of categories added + products added + a list of items where price parsing failed (saved as 0) so the superadmin knows what to fix in the admin UI.
- The OCR upload control sits below the existing image seeding controls in the AI Tools section.

</specifics>

<deferred>
## Deferred Ideas

- Multi-page batch upload (drop 6 photos at once, single combined LLM call) — possible v1.3 enhancement
- Review/staging screen with manual edits before commit — explicitly out of scope per REQUIREMENTS.md
- Cropping individual product images from the menu photo — separate concern; Phase 10 generates product images separately
- Handwritten menu OCR / low-quality photo enhancement — deferred per REQUIREMENTS.md
- Tenant-facing OCR upload (self-service) — deferred per REQUIREMENTS.md
- Daily rate limiting for OCR uploads (e.g., 10/day) — `ai_usage` is informational only in v1.2
- Async processing with `ai_jobs` + polling — deferred unless GPT-4.1-mini latency exceeds Vercel limits in practice

</deferred>

---

*Phase: 11-menu-photo-ocr*
*Context gathered: 2026-05-07*
