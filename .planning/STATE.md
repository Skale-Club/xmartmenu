# Project State

**Project:** xmartmenu
**Current milestone:** M1 — Foundation hardening
**Current phase:** 1 — Performance
**Last updated:** 2026-05-05

## Active Phase

**Phase 1: Performance**
Goal: Public menu loads faster — JS bundle shrinks, DB queries cached and parallelized, no admin JS leaked to public visitors.

Status: Planning

## Key Decisions

| Decision | Outcome | Date |
|---|---|---|
| Turbopack default for dev+build | Active — 2.25× faster than webpack | 2026-05-05 |
| `@next/bundle-analyzer` with `--webpack` flag | For baseline analysis only, not regular builds | 2026-05-05 |
| React `cache()` for metadata/page dedup | Planned for Phase 1 | 2026-05-05 |
| `revalidate = 60` for public menu | Planned for Phase 1 — menus change rarely | 2026-05-05 |

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
