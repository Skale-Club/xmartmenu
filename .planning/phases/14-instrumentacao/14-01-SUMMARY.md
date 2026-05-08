---
phase: 14-instrumentacao
plan: "01"
subsystem: infra
tags: [bundle-analyzer, webpack, next.js, performance, chunks]

# Dependency graph
requires: []
provides:
  - "Bundle analysis HTML treemaps at .next/analyze/client.html, edge.html, nodejs.html"
  - "Top 5 client-side chunk sizes with lazy-load candidacy assessment"
  - "Raw chunk data for 14-BASELINE.md (Plan 03)"
affects:
  - "14-03: Baseline documentation — consumes chunk names, sizes, lazy-load candidacy"
  - "16: Frontend Performance — uses baseline to set optimization targets"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ANALYZE=true npm run build --webpack triggers @next/bundle-analyzer (Turbopack incompatible — must use --webpack flag)"

key-files:
  created:
    - ".next/analyze/client.html — client bundle treemap (webpack)"
    - ".next/analyze/edge.html — edge bundle treemap (webpack)"
    - ".next/analyze/nodejs.html — node.js bundle treemap (webpack)"
  modified:
    - "package-lock.json — npm install in worktree to resolve @google/genai and all deps"

key-decisions:
  - "Turbopack does not support @next/bundle-analyzer — must pass --webpack flag to next build"
  - "Analyzer generates client.html, edge.html, nodejs.html (not server.html as plan noted)"
  - "Worktree required npm install — @google/genai not in parent node_modules"

patterns-established:
  - "Bundle analysis: always use ANALYZE=true npm run build --webpack (not default Turbopack)"

requirements-completed:
  - FE-03

# Metrics
duration: 4min
completed: 2026-05-08
---

# Phase 14 Plan 01: Bundle Analysis Summary

**Webpack bundle analysis run against production build — top 5 client chunks identified with lazy-load candidacy for 14-BASELINE.md**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-08T00:23:46Z
- **Completed:** 2026-05-08T00:27:52Z
- **Tasks:** 1
- **Files modified:** 1 (package-lock.json — worktree npm install)

## Accomplishments

- Bundle analyzer build ran successfully with `ANALYZE=true npm run build --webpack`
- Three HTML treemap reports generated: client.html, edge.html, nodejs.html
- Top 5 largest client-side chunks identified with sizes and lazy-load candidacy
- Raw data documented below for Plan 03 to write into 14-BASELINE.md

## Top 5 Client-Side Chunks (Raw Data for 14-BASELINE.md)

| Rank | Chunk | Size (KB) | Lazy-Load Candidate | Rationale |
|------|-------|-----------|---------------------|-----------|
| 1 | `3794-0147154ca0a4b9c9.js` | 216.2 | NO | Next.js App Router shared runtime (navigation, router internals) — critical path, cannot be deferred |
| 2 | `4bd1b696-c2f6e0877b6c10aa.js` | 195.2 | NO | react-dom — framework core, required for hydration on every page |
| 3 | `framework-d1de002210ddaaef.js` | 185.2 | NO | React + scheduler — framework bundle, cannot be lazy-loaded without breaking the app |
| 4 | `5536-037bccf2959a697c.js` | 170.1 | YES | Large shared vendor chunk (not named framework) — investigate module composition; may contain Supabase JS or AI SDK fragments pulled into client unexpectedly |
| 5 | `main-e29141c4c21a375c.js` | 128.3 | NO | Next.js main entry (hydration bootstrap) — loaded before any JS runs, cannot defer |

**Additional context (chunks 6-7 for completeness):**

| Rank | Chunk | Size (KB) | Lazy-Load Candidate | Rationale |
|------|-------|-----------|---------------------|-----------|
| 6 | `polyfills-42372ed130431b0a.js` | 110.0 | NO | Browserslist polyfills — cannot defer; loaded before app bootstrap |
| 7 | `44530001-ecf249e00c31b579.js` | 51.7 | YES | Unnamed shared chunk — likely shared UI component bundle (Tailwind, clsx, form components); candidate for splitting if component-level analysis confirms non-critical use |

**Largest named route-specific chunks (admin — all lazy-load candidates by definition):**

| Route | Chunk | Size (KB) | Lazy-Load Candidate |
|-------|-------|-----------|---------------------|
| /menu/products/[id] | page-0cd17edb88e56f76.js | 23.1 | YES — admin-only route |
| /superadmin/tenants | page-03d4a2ab4cbfdab6.js | 21.7 | YES — admin-only route |
| /superadmin/tenants/[id] | page-3beba05f7deba5e6.js | 20.2 | YES — admin-only route |
| /menu/products | page-3aa726b16dd2ef5d.js | 15.8 | YES — admin-only route |
| /superadmin/settings | page-c4a5949eb2f7debe.js | 13.8 | YES — admin-only route |

**Total client JS on critical path (non-deferrable):** ~819 KB uncompressed (chunks 1-3 + main + polyfills).

## Task Commits

Each task was committed atomically:

1. **Task 1: Run bundle analyzer and extract chunk sizes** - `db7126d` (chore)

**Plan metadata:** TBD (docs commit at end)

## Files Created/Modified

- `.next/analyze/client.html` — Interactive client bundle treemap (webpack)
- `.next/analyze/edge.html` — Edge runtime bundle treemap (webpack)
- `.next/analyze/nodejs.html` — Node.js server bundle treemap (webpack)
- `package-lock.json` — npm install in worktree (minor peer dep markers)

## Decisions Made

- **Turbopack incompatibility:** `@next/bundle-analyzer` does not work with Next.js 16.2 Turbopack builds. Must pass `--webpack` flag: `ANALYZE=true npm run build --webpack`. This is a known upstream limitation (documented in Next.js 16 release notes).
- **Output file names differ from plan:** Plan expected `client.html` and `server.html`. Actual output is `client.html`, `edge.html`, and `nodejs.html`. The `nodejs.html` is the server-side equivalent.
- **Worktree npm install required:** The worktree had no local `node_modules`. The parent repo's `node_modules` lacked `@google/genai` (dependency of scripts/seed-images.ts included in tsconfig). Ran `npm install` to resolve TypeScript check during build.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bundle analyzer incompatible with Turbopack default — added --webpack flag**
- **Found during:** Task 1 (Run bundle analyzer build)
- **Issue:** `ANALYZE=true npm run build` ran Turbopack by default; `@next/bundle-analyzer` explicitly not supported by Turbopack and outputs no report
- **Fix:** Added `--webpack` flag: `ANALYZE=true npm run build --webpack`; build succeeded in webpack mode, all three HTML reports generated
- **Files modified:** None (command-only fix, no config change needed)
- **Verification:** `.next/analyze/client.html` exists (Test-Path returns True)
- **Committed in:** Not applicable (no file change)

**2. [Rule 3 - Blocking] Missing node_modules in worktree — ran npm install**
- **Found during:** Task 1 (Run bundle analyzer build — first attempt)
- **Issue:** TypeScript check failed: `Cannot find module '@google/genai'` because worktree had no `node_modules`
- **Fix:** Ran `npm install` in worktree root; all 480 packages installed
- **Files modified:** `package-lock.json` (minor peer dependency marker additions)
- **Verification:** `@google/genai` module found; TypeScript check passed
- **Committed in:** `db7126d`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — Blocking)
**Impact on plan:** Both fixes required to complete the task. No scope creep. Build succeeded cleanly with all reports generated.

## Issues Encountered

- `@next/bundle-analyzer` and Turbopack are incompatible in Next.js 16.2 — this is a known upstream limitation. The `--webpack` workaround is stable and correct for analysis runs.
- Worktree git setup does not share `node_modules` with the main repo — standard behavior for git worktrees.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Raw chunk data documented above — Plan 03 can use this table directly when writing `14-BASELINE.md`
- Bundle analyze HTML treemaps available in `.next/analyze/` for manual inspection if needed
- Key optimization target: chunk `5536` (170.1 KB unnamed shared bundle) — investigate composition in Phase 16
- Framework chunks (chunks 1-3 + main + polyfills = ~819 KB) are non-deferrable baseline overhead for all routes

## Self-Check: PASSED

- FOUND: `.next/analyze/client.html` (Test-Path True)
- FOUND: `.next/analyze/nodejs.html` (Test-Path True)
- FOUND: commit `db7126d` (task commit in worktree)
- FOUND: `14-01-SUMMARY.md` at `.planning/phases/14-instrumentacao/14-01-SUMMARY.md`

---
*Phase: 14-instrumentacao*
*Completed: 2026-05-08*
