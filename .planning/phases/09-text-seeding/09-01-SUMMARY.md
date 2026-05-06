---
phase: 09-text-seeding
plan: 01
subsystem: database, ai, infra
tags: [ai-sdk, google-ai, zod, supabase, migration, typescript, prompt-injection]

# Dependency graph
requires: []
provides:
  - ai npm packages (ai@6.0.175, @ai-sdk/google@3.0.67, zod@4.4.3) installed
  - sanitizeForPrompt() utility at src/lib/ai/sanitize.ts
  - supabase/migrations/022_ai_usage.sql — ai_usage table + tenant_settings copy columns
  - AiUsage TypeScript interface in src/types/database.ts
  - TenantSettings extended with business_type, tagline, about fields
affects: [09-02, 09-03, 10-image-seeding, 11-ocr]

# Tech tracking
tech-stack:
  added: [ai@6.0.175, "@ai-sdk/google@3.0.67", zod@4.4.3]
  patterns:
    - sanitizeForPrompt used by all AI routes before inserting user data into prompts
    - ai_usage table tracks cost per tenant per feature per day via upsert pattern
    - RLS on ai_usage: superadmin-only (DO block wraps CREATE POLICY for idempotency)

key-files:
  created:
    - src/lib/ai/sanitize.ts
    - supabase/migrations/022_ai_usage.sql
  modified:
    - package.json
    - src/types/database.ts

key-decisions:
  - "ai SDK v6 paired with @ai-sdk/google v3 and zod v4 — no Zod v3/v4 mixing (AI SDK v6 requires Zod v4 internally)"
  - "sanitizeForPrompt strips backticks, braces, angle brackets, newlines — OWASP LLM Top 10 #1 prompt injection mitigation"
  - "ai_usage UNIQUE(tenant_id, feature_key, date) enables upsert cost accumulation without extra SELECT"
  - "Local Supabase not running (Docker unavailable) — migration 022 must be applied via Supabase SQL editor"

patterns-established:
  - "Pattern 1: sanitizeForPrompt(userInput, maxLength) — call before any user value enters a prompt string"
  - "Pattern 2: ai_usage upsert pattern — INSERT ... ON CONFLICT DO UPDATE SET call_count = call_count + 1"

requirements-completed: [AI-13, AI-15]

# Metrics
duration: 15min
completed: 2026-05-06
---

# Phase 9 Plan 01: AI Infrastructure — Text Seeding Summary

**Installed AI SDK v6 + @ai-sdk/google + Zod v4, created sanitizeForPrompt utility, migration 022 for ai_usage table and tenant_settings copy columns, and extended TypeScript types.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-06T21:05:57Z
- **Completed:** 2026-05-06T21:20:57Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- npm packages ai@6.0.175, @ai-sdk/google@3.0.67, zod@4.4.3 installed and verified in node_modules
- sanitizeForPrompt() created at src/lib/ai/sanitize.ts — strips prompt-injection chars, normalizes whitespace, truncates to maxLength
- Migration 022 created: ai_usage table with UNIQUE constraint and RLS; tenant_settings extended with business_type, tagline, about
- AiUsage TypeScript interface and TenantSettings fields added to src/types/database.ts — TypeScript compiles with 0 errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install npm packages and create sanitize utility** - `e6c6f6e` (feat)
2. **Task 2: Create migration 022 and extend TypeScript types** - `a911c42` (feat)

## Files Created/Modified

- `src/lib/ai/sanitize.ts` — sanitizeForPrompt() with prompt-injection strip + truncation
- `supabase/migrations/022_ai_usage.sql` — ai_usage table + RLS + tenant_settings columns
- `src/types/database.ts` — AiUsage interface added; TenantSettings extended with 3 AI copy fields
- `package.json` — ai, @ai-sdk/google, zod dependencies added

## Decisions Made

- ai SDK v6 uses Zod v4 internally — installed Zod v4.4.3 to avoid mixing (per STATE.md [v1.2 Roadmap] decision)
- sanitizeForPrompt strips `{}<>\n\r` and backticks to prevent prompt structure injection (OWASP LLM Top 10 #1)
- ai_usage UNIQUE(tenant_id, feature_key, date) enables cheap upsert accumulation (no extra SELECT per call)
- Used DO $$ ... END $$ block for CREATE POLICY in migration for safe idempotency (same pattern as prior migrations)

## Deviations from Plan

None — plan executed exactly as written. Local Supabase not running (Docker unavailable) as anticipated by plan — migration file created for manual apply via Supabase SQL editor.

## Issues Encountered

- First `npm install` background command produced TAR_ENTRY_ERROR warnings for existing node_modules but completed without error. Second sequential run confirmed package.json was updated with all three packages at correct versions.
- Local Supabase (Docker) not available for `npx supabase db push` — migration file created for manual SQL editor application.

## User Setup Required

Migration 022 must be applied manually:

1. Open Supabase SQL editor for the xmartmenu project
2. Run the contents of `supabase/migrations/022_ai_usage.sql`
3. Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'tenant_settings' AND column_name IN ('business_type', 'tagline', 'about');`
4. Verify: `SELECT tablename FROM pg_tables WHERE tablename = 'ai_usage';`

## Next Phase Readiness

- Phase 09-02 (seed route + Gemini integration) can proceed — all AI packages installed, sanitize utility available
- Phase 09-03 (superadmin UI) can proceed after 09-02 seed route is complete
- Migration 022 must be applied to Supabase before the seed route can write to ai_usage or read tenant_settings AI columns

---
*Phase: 09-text-seeding*
*Completed: 2026-05-06*
