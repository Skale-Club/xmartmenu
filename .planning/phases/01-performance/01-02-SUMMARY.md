---
phase: 01-performance
plan: 02
subsystem: infra
tags: [browserslist, webpack, polyfills, bundle-size, supabase, next.js]

# Dependency graph
requires:
  - phase: 000-perf-baseline
    provides: bundle analysis baseline showing polyfills chunk at 109 KB / 38 KB gz
provides:
  - browserslist field in package.json targeting modern evergreen browsers
  - PERF-02 verification: public routes confirmed free of browser Supabase client
  - Smaller polyfill bundle for all visitors (~60-80 KB raw expected, down from 109 KB)
affects: [01-performance, future bundle analysis runs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "browserslist in package.json: Next.js/webpack reads this at build time to skip native-browser polyfills"

key-files:
  created: []
  modified:
    - package.json

key-decisions:
  - "browserslist string '> 0.5%, last 2 versions, not dead, not IE 11' — targets evergreen browsers, skips IE/legacy polyfills"
  - "PERF-02 verified as read-only audit — no code changes needed, isolation already in place"

patterns-established:
  - "Public routes must only import from @/lib/supabase/server — never the browser client"

requirements-completed: [PERF-02, PERF-05]

# Metrics
duration: 2min
completed: 2026-05-05
---

# Phase 1 Plan 2: Browserslist + PERF-02 Verification Summary

**browserslist added to package.json targeting modern browsers to reduce polyfill bundle from 109 KB to ~60-80 KB; PERF-02 confirmed — public routes import only supabase/server**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-05T23:57:53Z
- **Completed:** 2026-05-05T23:59:20Z
- **Tasks:** 2 (1 file change + 1 read-only audit)
- **Files modified:** 1 (package.json)

## Accomplishments

- Added `"browserslist": "> 0.5%, last 2 versions, not dead, not IE 11"` to package.json as a top-level field after `"private"`, before `"scripts"`
- Next.js build succeeds with the new browserslist field — all 22 static pages generated, no errors
- PERF-02 verified: `grep -r "supabase/client" src/app/(public)/` returns zero matches — public routes are clean
- Both public route files (`[slug]/page.tsx` and `[slug]/[menuSlug]/page.tsx`) exclusively import `createServiceClient` from `@/lib/supabase/server`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add browserslist field to package.json** — `d2cb134` (chore)
2. **Task 2: Verify PERF-02** — read-only audit, no commit (no files modified)

**Plan metadata:** (pending — docs commit below)

## Files Created/Modified

- `package.json` — Added `"browserslist": "> 0.5%, last 2 versions, not dead, not IE 11"` as top-level field

## Decisions Made

- Used `> 0.5%, last 2 versions, not dead, not IE 11` as specified in CONTEXT.md — this is the canonical modern-browser target that excludes IE 11 and dead browsers while covering ~97% of real-world traffic
- No other fields in package.json were modified; only a single-line insertion

## Deviations from Plan

None - plan executed exactly as written. Task 2 was a read-only verification; the existing code already satisfied PERF-02.

## Issues Encountered

None. The build produced the expected warnings (pnpm workspace lockfile detection, deprecated middleware convention) which are pre-existing and unrelated to this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- browserslist in place; polyfill reduction will be visible in next webpack bundle analyzer run (`ANALYZE=true npx next build --webpack`)
- PERF-02 isolation is confirmed and must be maintained as a code review invariant
- Ready to proceed to plan 01-03 (caching/revalidation for public menu routes)

---
*Phase: 01-performance*
*Completed: 2026-05-05*

## Self-Check: PASSED

- FOUND: 01-02-SUMMARY.md
- FOUND: package.json with valid browserslist field
- FOUND: commit d2cb134
- PASS: PERF-02 (zero browser supabase/client imports in public routes)
