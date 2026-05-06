---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 1
status: executing
last_updated: "2026-05-05T23:59:20Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
  bar: "[█████░░░░░] 50%"
---

# Project State

**Project:** xmartmenu
**Current milestone:** M1 — Foundation hardening
**Current phase:** 1
**Last updated:** 2026-05-05 (01-02 complete)
**Last session stopped at:** Completed 01-performance-02-PLAN.md

## Active Phase

**Phase 1: Performance**
Goal: Public menu loads faster — JS bundle shrinks, DB queries cached and parallelized, no admin JS leaked to public visitors.

Status: Executing Phase 1

## Key Decisions

| Decision | Outcome | Date |
|---|---|---|
| Turbopack default for dev+build | Active — 2.25× faster than webpack | 2026-05-05 |
| `@next/bundle-analyzer` with `--webpack` flag | For baseline analysis only, not regular builds | 2026-05-05 |
| React `cache()` for metadata/page dedup | Planned for Phase 1 | 2026-05-05 |
| `revalidate = 60` for public menu | Planned for Phase 1 — menus change rarely | 2026-05-05 |
| `browserslist "> 0.5%, last 2 versions, not dead, not IE 11"` | Added to package.json — targets modern browsers to shrink polyfills chunk from 109 KB to ~60-80 KB | 2026-05-05 |
| PERF-02 verified (read-only) | Public routes confirmed to import only supabase/server — no browser client in public bundle | 2026-05-05 |

## Completed Phases

None yet.

## Baseline Metrics (2026-05-05)

From bundle analysis (`ANALYZE=true npx next build --webpack`):

- Total client JS: 1322 KB raw / 346 KB gz (all shared chunks)
- Top shared chunks: 216 KB (app code/MenuPage), 195 KB (React DOM), 170 KB (Supabase client)
- Supabase browser client in browser bundle: **confirmed** (chunk 5536, 47 KB gz)
- Per-route page bundles: lean (5–21 KB) — problem is shared chunks
- public menu page uses `force-dynamic` — no caching at all
- `generateMetadata` makes 1–2 extra DB queries duplicating page-render queries
- Root `/` page has `force-dynamic` despite being just a redirect
- 20 client components total

Full baseline in: `.planning/phases/000-perf-baseline/REPORT.md`
Analyzer reports: `.next/analyze/` (client.html, nodejs.html, edge.html)
