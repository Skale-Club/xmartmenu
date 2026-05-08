# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- ✅ **v1.1 Orders** — Phases 4-8 (shipped 2026-05-06)
- ✅ **v1.2 AI Onboarding** — Phases 9-11 (shipped 2026-05-07)
- ✅ **v1.3 Landing Page** — Phases 12-13 (shipped 2026-05-07)
- ✅ **v1.4 Performance** — Phases 14-17 (shipped 2026-05-08)
- ✅ **v1.5 Image Optimization** — Phases 18-20 (shipped 2026-05-08)
- 🚧 **v1.6 Operations** — Phases 21-22 (in progress)

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

| # | Phase | Plans | Status |
|---|---|---|---|
| 18 | WebP Upload Pipeline | 3/3 | ✅ 2026-05-08 |
| 19 | Admin next/image Migration | 3/3 | ✅ 2026-05-08 |
| 20 | Storage Abstraction | 1/1 | ✅ 2026-05-08 |

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

</details>

## 🚧 v1.6 Operations (In Progress)

- [x] **Phase 21: KDS Dashboard** — Grid/list toggle, order cards with status colors, elapsed-time chip, item summary, action button for status transitions (completed 2026-05-08)
- [ ] **Phase 22: Realtime + Per-Item Notes** — Supabase Realtime subscription (polling fallback), per-item notes schema, customer textarea, KDS and admin render of notes

## Phase Details

### Phase 21: KDS Dashboard
**Goal**: Kitchen staff can monitor all open orders at a glance via a color-coded, timed card grid and advance order status without leaving the page
**Depends on**: Phase 8 (orders view baseline), Phase 20 (v1.5 complete)
**Requirements**: KDS-01, KDS-02, KDS-03, KDS-04, KDS-05
**Success Criteria** (what must be TRUE):
  1. Admin sees orders in a card grid — each card shows order number, item summary, total, and a color-coded status badge (blue/yellow/green/grey/red)
  2. Each card displays an elapsed-time chip that turns amber after 10 minutes and red after 20 minutes, ticking every ~30 seconds without page reload
  3. Admin can advance an order through Pendente → Em preparo → Pronto → Concluído (or Cancelado) via a button on the card — the card updates immediately
  4. Admin can toggle between grid view (large cards, tablet-friendly) and the existing list/table view; the preference persists across sessions per tenant via localStorage
**Plans**: 2 plans

Plans:
- [x] 21-01-PLAN.md — Foundation: useElapsedTime hook + STATUS_COLORS + OrderCard component + grid layout + tenantId prop
- [x] 21-02-PLAN.md — Actions: view toggle with localStorage persistence + optimistic status PATCH wiring

**UI hint**: yes

### Phase 22: Realtime + Per-Item Notes
**Goal**: New orders appear automatically on the KDS without manual refresh, and customers can attach per-item notes that flow through to the kitchen card and admin orders table
**Depends on**: Phase 21
**Requirements**: KDS-06, NOTE-01, NOTE-02, NOTE-03, NOTE-04
**Success Criteria** (what must be TRUE):
  1. A new order placed by a customer appears on the KDS within 15 seconds without the kitchen staff refreshing the page (Supabase Realtime or polling fallback)
  2. When item_notes_enabled is on for a tenant, a customer sees a "Observações" textarea (max 140 chars with live counter) on the product modal and the note is saved with the order item
  3. Notes entered by the customer are visible on the KDS card and in the admin orders table, visually distinct from the item name (icon, italic, or distinct color)
**Plans**: 2 plans

Plans:
- [ ] 22-01-PLAN.md — DB migration 025 + TenantSettings type + Realtime subscription + 15s polling + notes display on KDS and admin modal
- [ ] 22-02-PLAN.md — item_notes_enabled Store Settings toggle + customer textarea in ProductModal + sanitizeNote API validation

**UI hint**: yes

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 21. KDS Dashboard | 2/2 | Complete    | 2026-05-08 |
| 22. Realtime + Per-Item Notes | 0/2 | Not started | - |
