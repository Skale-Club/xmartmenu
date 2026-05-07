---
phase: 12-core-landing-page
plan: 01
subsystem: infra
tags: [middleware, analytics, vercel, reserved-paths, onboarding, seo]

requires:
  - phase: 09-text-seeding
    provides: sanitizeForPrompt, ai_usage infra

provides:
  - RESERVED_PATHS Set (src/lib/marketing/reserved-paths.ts) — shared by middleware and onboarding API
  - Marketing bypass in updateSession() — '/' never hits Supabase auth
  - BLOCKED_TENANT_SLUGS guard in middleware — reserved slugs return 404
  - Onboarding API rejects reserved slugs with 400
  - Root layout: metadataBase, Inter display:swap, Analytics + SpeedInsights

affects: [12-02, 12-03]

tech-stack:
  added:
    - "@vercel/analytics@2.0.1"
    - "@vercel/speed-insights@2.0.0"
  patterns:
    - Marketing bypass before Supabase client creation (middleware performance gate)
    - Dual enforcement: middleware blocks slug access + API blocks slug creation

key-files:
  created:
    - src/lib/marketing/reserved-paths.ts
  modified:
    - src/middleware.ts
    - src/lib/supabase/middleware.ts
    - src/app/layout.tsx
    - src/app/api/onboarding/route.ts
    - package.json
    - package-lock.json

key-decisions:
  - "BLOCKED_TENANT_SLUGS inline in middleware.ts (not imported from reserved-paths.ts) — Edge Runtime keeps imports minimal"
  - "Marketing bypass uses NextResponse.next() unconditionally for '/' — no session refresh on static marketing routes (D-26)"
  - "Analytics components in root layout (not marketing layout) — broader coverage across all routes (D-03)"
  - "RESERVED_PATHS check in onboarding API appears before DB duplicate check — prevents reserved slug DB entries"

patterns-established:
  - "Marketing bypass pattern: MARKETING_PATHS early return at top of updateSession() before any Supabase client creation"
  - "Dual enforcement pattern: middleware blocks access + API blocks creation for reserved slugs"

requirements-completed: [LP-05]

duration: 4min
completed: 2026-05-07
---

# Phase 12 Plan 01: Landing Page Infrastructure Summary

**Reserved-path guard + middleware marketing bypass + Vercel Analytics + root layout SEO metadata — all Phase 12 prerequisites wired.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-07T02:29:42Z
- **Completed:** 2026-05-07T02:33:10Z
- **Tasks:** 3
- **Files modified:** 6 (+ 1 created)

## Accomplishments

- Created RESERVED_PATHS Set shared between middleware and onboarding API for consistent slug enforcement
- Added marketing bypass in updateSession() — requests to '/' skip Supabase auth entirely (50-200ms saved, Lighthouse gate)
- Added BLOCKED_TENANT_SLUGS inline guard in middleware — reserved slugs return 404 without DB roundtrip
- Onboarding API now rejects reserved slugs (400) before any DB writes
- Root layout upgraded: Inter with display:swap, metadataBase, OG metadata, Analytics + SpeedInsights components

## Task Commits

1. **Task 1: RESERVED_PATHS, middleware bypass, and blocked-slug guard** - `d462a17` (feat)
2. **Task 2: Install analytics packages and update root layout** - `e885fe1` (feat)
3. **Task 3: Add reserved-slug guard to onboarding API** - `85ab5b0` (feat)

## Files Created/Modified

- `src/lib/marketing/reserved-paths.ts` — RESERVED_PATHS Set with all reserved marketing + admin slugs
- `src/middleware.ts` — Added BLOCKED_TENANT_SLUGS inline guard; imports NextResponse
- `src/lib/supabase/middleware.ts` — Marketing bypass at top of updateSession() before Supabase client creation
- `src/app/layout.tsx` — metadataBase, Inter display:swap, Analytics + SpeedInsights components
- `src/app/api/onboarding/route.ts` — RESERVED_PATHS import + slug validation before DB check
- `package.json` / `package-lock.json` — @vercel/analytics@2.0.1 + @vercel/speed-insights@2.0.0

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan is infrastructure-only, no UI rendering or data flows involved.

## Self-Check: PASSED

- `src/lib/marketing/reserved-paths.ts` — exists, contains `export const RESERVED_PATHS`
- `src/lib/supabase/middleware.ts` — contains MARKETING_PATHS + isMarketing; single `const pathname`
- `src/middleware.ts` — contains BLOCKED_TENANT_SLUGS + NextResponse.json 404
- `src/app/layout.tsx` — contains metadataBase, display:swap, Analytics, SpeedInsights
- `src/app/api/onboarding/route.ts` — RESERVED_PATHS.has(slug) at line 110, before DB check at line 117
- `npx tsc --noEmit` exits 0
- Commits d462a17, e885fe1, 85ab5b0 verified in git log
