# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- ✅ **v1.1 Orders** — Phases 4-8 (shipped 2026-05-06)
- ✅ **v1.2 AI Onboarding** — Phases 9-11 (shipped 2026-05-07)
- ✅ **v1.3 Landing Page** — Phases 12-13 (shipped 2026-05-07)
- 🔄 **v1.4 Performance** — Phases 14-17 (active)

## Completed Milestones

<details>
<summary>✅ v1.0 Foundation (Phases 1-3) — SHIPPED 2026-05-06</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 1 | Performance | 2/2 | ✅ 2026-05-06 |
| 2 | Security | 3/3 | ✅ 2026-05-06 |
| 3 | CI/CD | 1/1 | ✅ 2026-05-06 |

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.1 Orders (Phases 4-8) — SHIPPED 2026-05-06</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 4 | Schema | 2/2 | ✅ 2026-05-06 |
| 5 | Admin Product Options UI | 3/3 | ✅ 2026-05-06 |
| 6 | Public Menu: Option Selectors + Cart | 3/3 | ✅ 2026-05-06 |
| 7 | Checkout | 2/2 | ✅ 2026-05-06 |
| 8 | Tenant Orders View | 1/1 | ✅ 2026-05-06 |

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.2 AI Onboarding (Phases 9-11) — SHIPPED 2026-05-07</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 9 | Text Seeding | 3/3 | ✅ 2026-05-06 |
| 10 | Image Seeding | 2/2 | ✅ 2026-05-07 |
| 11 | Menu Photo OCR | 3/3 | ✅ 2026-05-07 |

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.3 Landing Page (Phases 12-13) — SHIPPED 2026-05-07</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 12 | Core Landing Page | 3/3 | ✅ 2026-05-07 |
| 13 | SEO & Metadata | 2/2 | ✅ 2026-05-07 |

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

</details>

---

## v1.4 Performance — Active

### Phases

- [x] **Phase 14: Instrumentacao** — Establish real production baselines before any optimization (completed 2026-05-08)
- [x] **Phase 15: Database Indices** — EXPLAIN ANALYZE on critical queries and add indices where needed (completed 2026-05-08)
- [ ] **Phase 16: Frontend Performance** — Lighthouse scores, bundle optimization, and ISR cache tuning
- [ ] **Phase 17: CI Gate** — Lock Lighthouse regressions out of the main branch via GitHub Actions

### Phase Details

#### Phase 14: Instrumentacao
**Goal**: Real performance data is visible and actionable before any optimization work begins
**Depends on**: Nothing (first phase of milestone — Speed Insights already installed in v1.3)
**Requirements**: PERF-01, PERF-02, FE-03
**Success Criteria** (what must be TRUE):
  1. Core Web Vitals (LCP, CLS, INP) are readable by route in the Vercel Speed Insights dashboard with real production traffic data
  2. A bundle analysis report (via @next/bundle-analyzer) is generated and the top 3 largest chunks are identified with notes on lazy-loading candidates
  3. Supabase query timing is visible for the three critical paths (public menu, orders, tenant lookup) — either via pg_stat_statements or explicit server-side logging in the route handlers
  4. A written baseline note records current scores/timings so Phase 15 and 16 optimizations can be compared against it
**Plans**: 3 plans

Plans:
- [x] 14-01-PLAN.md — Run bundle analyzer, extract top 5 chunks with lazy-load assessment (FE-03) — DONE 2026-05-08
- [ ] 14-02-PLAN.md — Add timing probes to 3 routes, measure from Vercel logs, remove probes (PERF-02)
- [ ] 14-03-PLAN.md — PageSpeed Insights audit + write 14-BASELINE.md (PERF-01, FE-03, PERF-02)

#### Phase 15: Database Indices
**Goal**: Critical Supabase queries run on index scans, not sequential scans, eliminating DB-layer latency
**Depends on**: Phase 14 (baseline timings needed to confirm improvements)
**Requirements**: DB-01, DB-02, DB-03
**Success Criteria** (what must be TRUE):
  1. EXPLAIN ANALYZE output for the public menu query (`/{slug}`) shows no unnecessary Seq Scan; any added indices are documented in a migration comment
  2. EXPLAIN ANALYZE output for orders INSERT and admin orders SELECT shows no unnecessary Seq Scan; indices added where the planner defaults to Seq Scan on large row estimates
  3. EXPLAIN ANALYZE output for tenant lookup and auth middleware query shows no unnecessary Seq Scan; RLS policy queries confirmed to use indexed columns
  4. All new indices are applied via Supabase SQL editor and verified with a follow-up EXPLAIN ANALYZE showing the planner now uses Index Scan
**Plans**: 3 plans

Plans:
- [x] 15-01-PLAN.md — EXPLAIN ANALYZE public menu path (/{slug} + /{slug}/{menuSlug}), capture results (DB-01)
- [x] 15-02-PLAN.md — EXPLAIN ANALYZE orders + auth paths (POST/GET orders, RLS helpers), capture results (DB-02, DB-03)
- [x] 15-03-PLAN.md — Write migration 024, apply to Supabase, verify with follow-up EXPLAIN ANALYZE (DB-01, DB-02, DB-03)

#### Phase 16: Frontend Performance
**Goal**: Landing page and public menu score >= 90 on Lighthouse mobile, and ISR cache strategy matches real access patterns
**Depends on**: Phase 14 (bundle analysis and baseline scores needed before optimizing)
**Requirements**: FE-01, FE-02, FE-04
**Success Criteria** (what must be TRUE):
  1. Lighthouse mobile audit on `/` returns a Performance score >= 90 (measured via PageSpeed Insights or local Lighthouse CLI against production URL)
  2. Lighthouse mobile audit on a live `/{slug}` public menu page returns a Performance score >= 90
  3. ISR `revalidate` values are reviewed per route — landing page confirmed `force-static`, public menu revalidate value adjusted if access patterns justify a change from the current 60 s
  4. At least one actionable bundle optimization from Phase 14 analysis is applied (lazy import, dynamic() boundary, or tree-shaking fix) and bundle report confirms chunk size reduction
**Plans**: TBD
**UI hint**: yes

#### Phase 17: CI Gate
**Goal**: No PR can regress Lighthouse scores below the targets established in Phase 16
**Depends on**: Phase 16 (scores must be >= 90 before setting a regression threshold)
**Requirements**: PERF-03
**Success Criteria** (what must be TRUE):
  1. A Lighthouse CI workflow file exists in `.github/workflows/` and runs on every PR targeting main
  2. The workflow fails (blocking merge) when Lighthouse mobile Performance score drops below the configured threshold
  3. The threshold is documented in the workflow file as a comment referencing the Phase 16 baseline scores
**Plans**: TBD

### Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 14. Instrumentacao | 1/3 | Complete    | 2026-05-08 |
| 15. Database Indices | 1/3 | Complete    | 2026-05-08 |
| 16. Frontend Performance | 0/? | Not started | - |
| 17. CI Gate | 0/? | Not started | - |
