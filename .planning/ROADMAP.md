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
- 🔄 **v1.8 KDS+** — Phases 26-27 (in progress)

## Phases

- [ ] **Phase 26: Schema + Settings** - Threshold columns in DB, Store Settings UI, useElapsedTime hook decoupled from hardcoded constants
- [ ] **Phase 27: Filter Chips + Sound** - KDS status filter chips, mute button, and Web Audio API beep on new orders

## Phase Details

### Phase 26: Schema + Settings
**Goal**: Kitchen staff see order urgency colours driven by per-tenant thresholds that admins control in Store Settings
**Depends on**: Phase 25 (KDS card infrastructure, useElapsedTime hook)
**Requirements**: KDS-07, KDS-08, KDS-09
**Success Criteria** (what must be TRUE):
  1. Admin can open Store Settings and see two numeric inputs (Amber threshold / Red threshold) with 1-120 min range; saving persists to DB
  2. Validation rejects amber >= red or either value <= 0 with a clear error message — value is not saved
  3. KDS order cards reflect the saved thresholds: a card turns amber after `amber_threshold_minutes` and red after `red_threshold_minutes` (no page reload needed)
  4. New tenants get sensible defaults (amber=10, red=20) from the migration — KDS works before an admin ever touches Settings
**Plans**: 1 plan
Plans:
- [ ] 26-01-PLAN.md — Migration 027 + TypeScript types + useElapsedTime refactor + OrdersClient prop threading + StoreClient KDS section
**UI hint**: yes

### Phase 27: Filter Chips + Sound
**Goal**: Kitchen staff can focus on the orders that need attention and are alerted the instant a new order arrives
**Depends on**: Phase 26
**Requirements**: KDS-10, KDS-11, KDS-12, KDS-13
**Success Criteria** (what must be TRUE):
  1. KDS header shows four chips — Pendentes, Em preparo, Prontos, Todos — and only pending+preparing orders appear by default; clicking a chip immediately filters the visible cards
  2. The active filter chip survives a page reload (persisted per tenant in localStorage)
  3. A new order arriving via Realtime INSERT produces an audible beep automatically; the beep does not play for status-only updates
  4. Mute/unmute button in the KDS header silences/restores the beep; the muted state survives a page reload (persisted per tenant in localStorage)
**Plans**: TBD
**UI hint**: yes

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 26. Schema + Settings | 0/1 | Not started | - |
| 27. Filter Chips + Sound | 0/? | Not started | - |

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

| # | Phase | Plans | Status |
|---|---|---|---|
| 23 | Ingredient Schema | 1/1 | ✅ 2026-05-08 |
| 24 | Admin Catalog | 2/2 | ✅ 2026-05-08 |
| 25 | Customer + Kitchen | 2/2 | ✅ 2026-05-08 |

See `.planning/milestones/v1.7-ROADMAP.md` for full details.

</details>
