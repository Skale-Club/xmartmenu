---
phase: 14-instrumentacao
plan: "03"
subsystem: instrumentation
tags: [lighthouse, pagespeed-insights, baseline, perf-01, fe-03, perf-02]
status: complete
dependency_graph:
  requires:
    - "14-01: bundle chunk data"
    - "14-02: timing probe infrastructure (timings deferred)"
  provides:
    - "14-BASELINE.md — authoritative pre-optimization baseline for Phase 15 and 16"
  affects:
    - "15: Database Indices — reads Supabase Query Timing section"
    - "16: Frontend Performance — reads all three sections"
tech-stack:
  added: []
  patterns:
    - "PageSpeed Insights synthetic Lighthouse, mobile emulation — D-08 binding metric"
key-files:
  created:
    - ".planning/phases/14-instrumentacao/14-BASELINE.md — pre-optimization baseline (all three deliverables)"
key-decisions:
  - "User tested /{slug} tenant landing page (not /{slug}/{menuSlug}) — both are valid public routes; /{slug} is the binding Phase 16 target"
  - "Speed Insights has no real-traffic data — rely on PSI synthetic Lighthouse only"
  - "Landing page (/) scores 100 — Phase 16 focus must be on /{slug} exclusively"
  - "889 KB image delivery is the dominant optimization issue on /{slug}"
  - "LCP 3.0s on /{slug} is the primary Phase 16 Lighthouse target — must get below 2.5s"
  - "DB timings remain N/A from Plan 02 deferral — Phase 15 must use EXPLAIN ANALYZE as primary signal"
requirements-completed:
  - PERF-01
  - FE-03
  - PERF-02

# Metrics
duration: "~20 min (continuation agent)"
completed: 2026-05-07
tasks_completed: 2
tasks_total: 2
files_modified: 1
---

# Phase 14 Plan 03: Baseline Documentation Summary

**PSI scores recorded for two public routes and consolidated with bundle and timing data into 14-BASELINE.md — Phase 14 instrumentation complete**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-05-07
- **Tasks:** 2 (1 human checkpoint + 1 auto)
- **Files created:** 1

## Accomplishments

- PSI scores collected for two public routes: landing page (/) and tenant slug (/{slug})
- 14-BASELINE.md written with all four sections: Lighthouse Scores, Bundle Analysis, Supabase Query Timing, Phase 15/16 Targets
- All three Phase 14 requirements satisfied: PERF-01 (Lighthouse), FE-03 (bundle), PERF-02 (timing — deferred but documented)
- Phase 15 and 16 planners have a single authoritative before-state file to read

## PSI Results Summary

| Route | URL | Mobile Perf | LCP | CLS | TBT | A11y | SEO |
|-------|-----|------------|-----|-----|-----|------|-----|
| / | https://xmartmenu.skale.club/ | **100** | 1.5s | 0 | 90ms | 96 | 100 |
| /{slug} | https://xmartmenu.skale.club/restaurante-teste | **94** | 3.0s | 0 | 20ms | 88 | 100 |

**Key findings (/{slug}):**
- PSI flagged "Improve image delivery — Est savings of 889 KiB" (CRITICAL)
- LCP 3.0s in NEEDS IMPROVEMENT range (threshold: 2.5s)
- Accessibility issues: buttons missing accessible names, insufficient color contrast, no `<main>` landmark

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 | Human checkpoint — PSI scores collected | N/A (human action) |
| Task 2 | Write 14-BASELINE.md | `88fd231` |

## Files Created

- `.planning/phases/14-instrumentacao/14-BASELINE.md` — pre-optimization baseline with all four sections

## Decisions Made

- **User tested /{slug} not /{slug}/{menuSlug}:** Both routes are valid. The /{slug} tenant landing page is the Phase 16 target — it has a real Supabase DB query (tenant lookup + default menu), unlike / which is force-static.
- **Landing page excluded from Phase 16 optimization scope:** Score 100, all CWV in GOOD range — no action needed.
- **Phase 16 primary target:** /{slug} LCP 3.0s → below 2.5s, via image delivery fix (889 KB savings).
- **Phase 15 must use EXPLAIN ANALYZE:** No wall-clock timing data available (deferred in Plan 02). EXPLAIN ANALYZE query planner output is sufficient to identify Seq Scans.

## Deviations from Plan

### Context Deviation

**1. [User Decision] /{slug} tested instead of /{slug}/{menuSlug}**
- **Found during:** Task 1 checkpoint resume signal
- **Issue:** Plan specified public menu (/{slug}/{menuSlug}) as Route 1 priority. User ran PSI on /{slug} tenant landing instead.
- **Fix:** Accepted. /{slug} is a valid public route with server-side DB queries and is the binding Phase 16 target. Data is accurate and actionable.
- **Impact:** None — /{slug} is equally relevant for Phase 16. 14-BASELINE.md documents the route that was actually tested.

**2. [Context] 14-01-SUMMARY.md not present in worktree**
- **Found during:** Task 2 setup
- **Issue:** 14-01-SUMMARY.md was committed on main but not pulled into this worktree (worktree branched before Plan 01 completed on main).
- **Fix:** Retrieved file via `git show main:.planning/phases/14-instrumentacao/14-01-SUMMARY.md`. All bundle data obtained successfully.
- **Impact:** None — all data correctly populated in 14-BASELINE.md.

## Known Stubs

None — this plan produces documentation only. No UI or runtime code.

## Self-Check: PASSED

- [x] `.planning/phases/14-instrumentacao/14-BASELINE.md` exists (Test-Path True)
- [x] Commit `88fd231` — docs(14-03): write 14-BASELINE.md
- [x] Section "## Lighthouse Scores" present in file
- [x] Section "## Bundle Analysis" present in file
- [x] Section "## Supabase Query Timing" present in file
- [x] Section "## Phase 15 and 16 Targets" present in file
- [x] No placeholder brackets [N], [NN], [name] in file
- [x] Requirements PERF-01, FE-03, PERF-02 completed

---
*Phase: 14-instrumentacao*
*Completed: 2026-05-07*
