---
phase: 09-text-seeding
plan: 02
subsystem: api, ai, database
tags: [gemini, ai-sdk, zod, supabase, typescript, seed, revalidatepath, prompt-injection]

# Dependency graph
requires:
  - phase: 09-01
    provides: sanitizeForPrompt utility, ai/zod packages, ai_usage migration, AiUsage types
provides:
  - POST /api/superadmin/tenants/[id]/seed route handling all 6 seed types
  - src/lib/ai/schemas.ts with Zod schemas for LLM structured output
  - Additive-only category and product inserts with position tracking
  - Non-blocking ai_usage logging after every LLM call
  - ISR cache invalidation via revalidatePath after DB writes
affects: [09-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - generateObject from ai SDK with Zod schema for structured Gemini output
    - Additive-only insert pattern — pre-fetch existing names, filter before insert
    - MAX(position) fetch before insert to maintain correct ordering
    - Non-blocking ai_usage upsert wrapped in try/catch — errors logged, not thrown
    - revalidatePath called after all DB writes succeed (both tenant and menu-level paths)
    - Node.js runtime declaration required for Gemini SDK

key-files:
  created:
    - src/lib/ai/schemas.ts
    - src/app/api/superadmin/tenants/[id]/seed/route.ts
  modified: []

key-decisions:
  - "Single route with type field in POST body — handles all 6 seed types (menu, categories, products, copy, single_category, single_product) without proliferating routes"
  - "Zod v4 z.record requires two args: z.record(z.string(), z.any()) — single-arg form is not valid in Zod v4"
  - "TranslationsSchema kept as z.record(z.string(), z.any()) per Pitfall 3 — avoids Gemini structured output validation failures with deeply nested schemas"
  - "tenant_id always from URL param [id], never from request body — established superadmin auth pattern"
  - "ai_usage upsert uses onConflict: tenant_id,feature_key,date — cost accumulation without extra SELECT"

patterns-established:
  - "Pattern 1: generateObject(model, schema, prompt) — structured LLM output with automatic Zod validation"
  - "Pattern 2: additive-only insert — pre-fetch existing Set<string>, filter generated items before insert"
  - "Pattern 3: position = MAX(position) + offset — computed before each insert batch to preserve ordering"
  - "Pattern 4: non-blocking ai_usage — try/catch around upsert, errors logged with console.error only"

requirements-completed: [AI-01, AI-02, AI-03, AI-04, AI-05, AI-14]

# Metrics
duration: 25min
completed: 2026-05-06
---

# Phase 9 Plan 02: Seed API Route — Text Seeding Summary

**Created the core seed API route (POST /api/superadmin/tenants/{id}/seed) handling all 6 AI text seeding operations with Gemini 2.5 Flash, additive-only DB writes, non-blocking usage logging, and ISR cache invalidation.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-06T22:00:00Z
- **Completed:** 2026-05-06T22:25:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/lib/ai/schemas.ts` with four exported Zod schemas: MenuSeedSchema, CopySeedSchema, SingleCategorySeedSchema, SingleProductSeedSchema — all using flat `z.record(z.string(), z.any())` for translations per Pitfall 3
- Created `src/app/api/superadmin/tenants/[id]/seed/route.ts` with POST handler dispatching all 6 seed types
- Auth guard via `assertSuperadmin()` — returns 401 for non-superadmin callers
- All user-supplied strings (businessType, companyName) sanitized via `sanitizeForPrompt` before LLM interpolation
- Additive-only inserts — existing category/product names (case-insensitive) are skipped
- Positions computed from `MAX(position)` before each insert batch to maintain display order
- `ai_usage` upsert fires after every LLM call, wrapped in try/catch (non-blocking)
- `revalidatePath` called for both tenant slug and menu slug paths after all DB writes succeed
- TypeScript compiles with 0 errors after fixing Zod v4 two-argument `z.record` requirement

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Zod schemas** - `d8a95ca` (feat)
2. **Task 2: Create seed API route + fix Zod v4 syntax** - `945ce7d` (feat)

## Files Created/Modified

- `src/lib/ai/schemas.ts` — Four Zod schemas for LLM structured output validation
- `src/app/api/superadmin/tenants/[id]/seed/route.ts` — POST handler for all seed types

## Decisions Made

- Single route with `type` body field rather than separate routes — consistent with existing superadmin pattern, keeps route tree flat
- `z.record(z.string(), z.any())` for translations — Zod v4 requires two arguments; also keeps schema flat to avoid Gemini structured output failures (Pitfall 3 from RESEARCH.md)
- `tenant_id` always from URL param `[id]` — never from request body (established security pattern)
- `onConflict: 'tenant_id,feature_key,date'` on ai_usage upsert — accumulates call/token counts without extra SELECT

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod v4 two-argument z.record syntax**
- **Found during:** Task 2 TypeScript verification
- **Issue:** `z.record(z.any())` throws TS2554 "Expected 2-3 arguments, but got 1" in Zod v4
- **Fix:** Changed to `z.record(z.string(), z.any())` in `schemas.ts`
- **Files modified:** `src/lib/ai/schemas.ts`
- **Commit:** `945ce7d`

**2. [Rule 3 - Blocking] npm install required for ai/@ai-sdk/google packages**
- **Found during:** Task 2 TypeScript verification
- **Issue:** packages were in package.json but not installed in node_modules (previous plan added package.json entries but did not run npm install in this worktree)
- **Fix:** Ran `npm install` to populate node_modules with ai@6.0.175 and @ai-sdk/google@3.0.67
- **Files modified:** none (node_modules not tracked)
- **Commit:** N/A (not a tracked file change)

## Known Stubs

None — all DB writes and LLM calls are fully wired. The route reads real tenant/menu data from Supabase and calls Gemini via the AI SDK.

## Next Phase Readiness

- Phase 09-03 (superadmin UI) can proceed — seed route is ready to receive POST requests with type, menuId, businessType, companyName
- GOOGLE_GENERATIVE_AI_API_KEY must be set in Vercel env vars and .env.local before the route can make live Gemini calls (documented in Plan 01 user setup section)

## Self-Check: PASSED

- FOUND: src/lib/ai/schemas.ts
- FOUND: src/app/api/superadmin/tenants/[id]/seed/route.ts
- FOUND: .planning/phases/09-text-seeding/09-02-SUMMARY.md
- Commit d8a95ca — feat(09-02): create Zod schemas for all seed operation types
- Commit 945ce7d — feat(09-02): create seed API route and fix Zod v4 record syntax
- `npx tsc --noEmit` exits 0

---
*Phase: 09-text-seeding*
*Completed: 2026-05-06*
