# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- ✅ **v1.1 Orders** — Phases 4-8 (shipped 2026-05-06)
- ✅ **v1.2 AI Onboarding** — Phases 9-11 (shipped 2026-05-07)
- ✅ **v1.3 Landing Page** — Phases 12-13 (shipped 2026-05-07)
- ✅ **v1.4 Performance** — Phases 14-17 (shipped 2026-05-08)
- ✅ **v1.5 Image Optimization** — Phases 18-20 (shipped 2026-05-08)
- ✅ **v1.6 Operations** — Phases 21-22 (shipped 2026-05-08)
- ✅ **v1.7 Customization** — Phases 23-25 (shipped 2026-05-08)
- ✅ **v1.8 KDS+** — Phases 26-27 (shipped 2026-05-08)
- ⏳ **v1.9 Performance Gaps** — Phases 28-29 (in progress)

## Completed Milestones

<details>
<summary>✅ v1.0 Foundation (Phases 1-3) — SHIPPED 2026-05-06</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.1 Orders (Phases 4-8) — SHIPPED 2026-05-06</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.2 AI Onboarding (Phases 9-11) — SHIPPED 2026-05-07</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.3 Landing Page (Phases 12-13) — SHIPPED 2026-05-07</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.4 Performance (Phases 14-17) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.4-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.5 Image Optimization (Phases 18-20) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.6 Operations (Phases 21-22) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.7 Customization (Phases 23-25) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.7-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.8 KDS+ (Phases 26-27) — SHIPPED 2026-05-08</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 26 | Schema + Settings | 1/1 | ✅ 2026-05-08 |
| 27 | Filter Chips + Sound | 1/1 | ✅ 2026-05-08 |

See `.planning/milestones/v1.8-ROADMAP.md` for full details.

</details>

## v1.9 Performance Gaps — Phases 28-29

**Goal:** Fechar gaps restantes do SEED-004 — índices RLS em `profiles`, CDN headers imutáveis nas imagens, decomposição do `MenuPage.tsx`.

| # | Phase | Plans | Requirements | Status |
|---|---|---|---|---|
| 28 | DB + CDN | 1/1 | PERF-01, PERF-02, PERF-03, PERF-04 | ✅ 2026-05-08 |
| 29 | MenuPage Decomposition | 1/1 | PERF-05, PERF-06 | ⏳ Pending |

## Phase Details

### Phase 28: DB + CDN
**Goal**: DB indices on `profiles` are live and Storage buckets serve images with long-lived immutable cache headers
**Depends on**: Nothing (first phase of v1.9)
**Requirements**: PERF-01, PERF-02, PERF-03, PERF-04
**Success Criteria** (what must be TRUE):
  1. Migration 028 is applied — `EXPLAIN ANALYZE` on a `profiles` query filtered by `tenant_id` shows an index scan, not a sequential scan
  2. `EXPLAIN ANALYZE` on a `profiles` query filtered by `role` shows an index scan
  3. Both `tenant-assets` and `product-images` Storage buckets respond with `Cache-Control: public, max-age=31536000, immutable` on image URLs
  4. No regression on any existing RLS policy (all protected routes still require authenticated session)
**Plans**: 1 plan

Plans:
- [x] 28-01-PLAN.md — Migration 028 (3 profiles indices) + CDN cache headers on both Storage buckets

### Phase 29: MenuPage Decomposition
**Goal**: `MenuPage.tsx` is split into focused components with lazy-loaded modals, reducing initial JS payload for the public menu
**Depends on**: Phase 28
**Requirements**: PERF-05, PERF-06
**Success Criteria** (what must be TRUE):
  1. `src/components/menu/ProductModal.tsx` exists as a self-contained component with explicit props — no implicit shared state with `MenuPage`
  2. `src/components/menu/CartModal.tsx` exists as a self-contained component with explicit props covering cart items, order form, and submission
  3. Both components are imported in `MenuPage.tsx` via `next/dynamic` with `ssr: false` — they are absent from the initial server-rendered HTML
  4. `tsc --noEmit` passes with zero new type errors after the extraction
  5. Public menu page loads and functions end-to-end: product modal opens on tap, cart accumulates items, order submits successfully
**Plans**: TBD
**UI hint**: yes
