# Phase 9: Text Seeding — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Superadmin-only AI text seeding for tenant menus. This phase builds the UI entry point in the superadmin tenant detail page, the API route that calls Gemini 2.5, and the shared infrastructure (ai_usage table, prompt injection sanitization, revalidatePath). Phases 10 and 11 inherit this infrastructure.

The tenant's onboarding flow is NOT modified. Tenants see a fully-populated menu in their regular admin UI after superadmin seeds it.

</domain>

<decisions>
## Implementation Decisions

### Who Uses AI
- **D-01:** AI seeding is superadmin-only. Tenants never see AI generation buttons, options, or loading states. The system presents the generated content as if it were always there.

### UI Placement
- **D-02:** AI Tools section added at the bottom of the existing superadmin tenant detail page (`/(superadmin)/tenants/[id]`). No new route needed.
- **D-03:** Two levels of seeding in the UI:
  - Bulk: "Seed menu" button (generates everything in one call) AND separate buttons "Seed categories", "Seed products", "Seed copy" for targeted sections
  - Per-item: "Seed" button inline next to the "Add category" and "Add product" inputs in the superadmin tenant view — generates that single item only

### LLM Provider
- **D-04:** Gemini 2.5 via `@ai-sdk/google` for all text seeding. Add `GOOGLE_GENERATIVE_AI_API_KEY` to Vercel environment variables. OCR (Phase 11) stays on OpenAI GPT-4.1-mini. Images (Phase 10) stay on `gpt-image-1-mini`.
- **D-05:** Single LLM call returns all enabled languages at once. Prompt requests JSON with locale keys (e.g. `{ "en": "...", "pt": "..." }`). The tenant's enabled languages are read from their profile/settings before calling.

### Data Writing
- **D-06:** Generated content writes directly to the tenant's `categories` and `products` tables — no intermediate draft table, no review screen. The regular admin UI is the editor for any corrections.
- **D-07:** Seeding is additive only — skip existing records. If a category or product with the same name already exists for the tenant, do not overwrite it. Safe to run multiple times.
- **D-08:** Prompt input: `business_type` + `company_name`. Both are sanitized (strip special chars, truncate) before interpolation into LLM prompts to prevent prompt injection. No other fields passed to LLM.

### Infrastructure (shared with Phases 10 and 11)
- **D-09:** `ai_usage` table schema: `(id, tenant_id, feature_key, date, call_count, token_count, created_at)`. Not a blocking gate — used for cost attribution only. Superadmin can view usage in Phase 9 or later.
- **D-10:** `revalidatePath()` called after every seeding write that modifies tenant menu data. Prevents the 60s ISR cache from serving stale content after a tenant's menu is seeded.
- **D-11:** Prompt injection sanitization is a utility function (`sanitizeForPrompt(str: string): string`) added in `src/lib/ai/sanitize.ts` so all three phases use the same function.

### Claude's Discretion
- The exact Gemini 2.5 model variant (e.g. `gemini-2.5-flash` vs `gemini-2.5-pro`) — choose based on cost/quality tradeoff at planning time. Flash is fine for menu copy.
- The number of products generated per category — 3–5 representative items is a reasonable default; planner decides.
- Structure of the `api/superadmin/tenants/[id]/seed` route(s) — single route with a `type` param or separate routes per feature; planner decides.
- Whether `ai_usage` gets a superadmin list UI in Phase 9 or is deferred to a later phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing superadmin tenant UI
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — existing tenant detail component; AI Tools section goes here
- `src/app/(superadmin)/tenants/[id]/page.tsx` — server component that fetches tenant data

### Existing superadmin API routes (patterns to follow)
- `src/app/api/superadmin/tenants/[id]/route.ts` — existing tenant detail API; follow same auth pattern (`assertSuperadmin()`)
- `src/app/api/superadmin/tenants/[id]/settings/route.ts` — example of nested route under tenant

### Existing data tables (seeding writes here)
- `supabase/migrations/019_full_schema_sync.sql` — canonical schema; categories and products tables
- `src/types/database.ts` — TypeScript types for all tables; extend with `ai_usage` in this phase

### Auth / tenant isolation
- `src/lib/superadmin-auth.ts` — `assertSuperadmin()` utility; all new AI routes must call this first

### Existing onboarding API (do NOT modify for AI)
- `src/app/api/onboarding/route.ts` — complex 5-candidate fallback chain; AI seeding is a separate concern

### Research artifacts (read for implementation details)
- `.planning/research/STACK.md` — library versions, AI SDK v6 patterns, note that DALL-E 3 is retired May 12 2026
- `.planning/research/ARCHITECTURE.md` — route structure, timeout strategy, existing Sharp pipeline reuse
- `.planning/research/PITFALLS.md` — prompt injection, ISR cache invalidation, rate limiting patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/superadmin-auth.ts` (`assertSuperadmin()`): Guards all superadmin API routes — use on every new AI route
- `src/lib/supabase/server.ts` + `client.ts`: Standard Supabase client creation patterns already in place
- `src/lib/upload.ts` (`validateAndConvertToWebP()`): Sharp pipeline for image WebP conversion — reused in Phase 10

### Established Patterns
- Superadmin API routes use `assertSuperadmin()` from `src/lib/superadmin-auth.ts` then extract `tenant_id` from the URL param (never from request body)
- Server components fetch data, pass as props to `*Client.tsx` components that have `'use client'`
- Existing `TenantDetailClient.tsx` already receives tenant data as props — AI Tools section follows the same pattern

### Integration Points
- New migration `022_ai_usage.sql` adds the `ai_usage` table
- New file `src/lib/ai/sanitize.ts` — shared prompt sanitization utility
- New API route `src/app/api/superadmin/tenants/[id]/seed/route.ts` (or similar) — handles POST requests for seeding
- `TenantDetailClient.tsx` gains an "AI Tools" section at the bottom that calls the new seed API route

</code_context>

<specifics>
## Specific Ideas

- The AI Tools section should display the tenant's current `business_type` so the superadmin can confirm before seeding
- Both "Seed menu" (bulk) and per-section buttons ("Seed categories", "Seed products", "Seed copy") must exist — user explicitly wants both
- Gemini 2.5 Flash is the default text model; upgrade to Pro only if output quality is insufficient for menu copy
- `sanitizeForPrompt()` strips characters that could break prompt structure: backticks, `{`, `}`, angle brackets, and trims to a max length (e.g. 100 chars for company_name)

</specifics>

<deferred>
## Deferred Ideas

- Superadmin dashboard showing total AI cost per tenant (ai_usage aggregated view) — deferred post-Phase 9
- Draft/undo for seeding operations — user confirmed direct-to-DB with no drafts; corrections go through regular admin UI
- Per-tenant feature flags for AI — not needed since AI is superadmin-only (always available to superadmin)
- Daily rate limiting that blocks API calls — ai_usage is informational only in v1.2

</deferred>

---

*Phase: 09-text-seeding*
*Context gathered: 2026-05-06*
