---
phase: 21-kds-dashboard
plan: 02
subsystem: ui
tags: [kds, orders, localStorage, react-hooks, tailwind, lucide-react, optimistic-ui]

# Dependency graph
requires:
  - phase: 21-01
    provides: OrderCard, STATUS_COLORS, NEXT_STATUS, ADVANCE_LABEL, loadingId pattern, view state scaffolded, tenantId prop
provides:
  - localStorage persistence for KDS view preference per tenant (kds_view_{tenantId})
  - Grid/list toggle buttons with active-state styling (LayoutGrid/List icons)
  - Conditional grid/list render — grid shows OrderCard grid, list shows existing table
  - Fully wired optimistic status-advance buttons (Iniciar preparo / Marcar pronto / Concluir / Cancelar) on cards
  - Per-card loading isolation via loadingId (other cards remain interactive during PATCH)
affects: [22-realtime-per-item-notes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "localStorage read inside useEffect (SSR-safe) — no typeof window guards"
    - "KDS_VIEW_KEY(tenantId) module-level function for per-tenant localStorage key scoping"
    - "toggleView function that updates React state and persists to localStorage atomically"
    - "ternary conditional render (grid branch / list branch) driven by view state"

key-files:
  created: []
  modified:
    - src/app/(admin)/orders/OrdersClient.tsx

key-decisions:
  - "localStorage read in useEffect only (SSR-safe) — never in useState initializer or render body"
  - "List view reuses the existing table + modal pattern (setSelectedOrder on row click) — no new modal needed"
  - "Pre-existing @aws-sdk TypeScript errors in storage/index.ts are out-of-scope (Phase 20 deferred issue, not caused by this plan)"

patterns-established:
  - "Pattern: KDS_VIEW_KEY(tenantId) => `kds_view_${tenantId}` — per-tenant preference key, prevents cross-tenant sharing"
  - "Pattern: useEffect read + toggleView write — clean separation of localStorage read (on mount) vs write (on user action)"

requirements-completed: [KDS-04, KDS-05]

# Metrics
duration: 10min
completed: 2026-05-08
---

# Phase 21 Plan 02: KDS View Toggle Summary

**localStorage-persisted grid/list toggle with LayoutGrid/List icons, SSR-safe useEffect read, and verified optimistic status-advance wiring on KDS cards**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-08T12:15:00Z
- **Completed:** 2026-05-08T12:25:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `KDS_VIEW_KEY` helper at module level and `useEffect` to restore saved view on mount (SSR-safe — localStorage only accessed inside effect)
- Added `toggleView` function that updates `view` state and writes to `localStorage.setItem(KDS_VIEW_KEY(tenantId), next)` atomically
- Added grid/list toggle button pair in the header (LayoutGrid/List icons from lucide-react, dark bg on active, aria-labels in PT-BR)
- Wired conditional content render: `view === 'grid'` shows OrderCard grid, else shows existing table (rows open modal via setSelectedOrder)
- Verified optimistic PATCH wiring is complete: `loadingId` pattern, `onAdvance`/`onCancel` wired to `updateStatus`, no old `loading: boolean` state, PATCH updates only on `res.ok`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add localStorage persistence for view toggle** - `3ab1b9b` (feat)
2. **Task 2: Verify optimistic PATCH wiring and TypeScript build** - no new commit (verification-only, no code changes needed)

## Files Created/Modified

- `src/app/(admin)/orders/OrdersClient.tsx` — Added `useEffect` + `useLayoutGrid`/`List` imports, `KDS_VIEW_KEY` constant, `toggleView` function, toggle button UI in header, conditional grid/list content render

## Decisions Made

- `localStorage` read lives exclusively in `useEffect` — the correct SSR-safe pattern for Next.js App Router (avoids `ReferenceError: localStorage is not defined` during server render)
- List view reuses the table that already existed in the original `OrdersClient.tsx` pre-Plan-01, with `setSelectedOrder(order)` on row click to open the existing modal — no new modal logic required
- Pre-existing TypeScript errors in `src/lib/storage/index.ts` (missing `@aws-sdk` type declarations from Phase 20) are out of scope — they existed before this plan and are not caused by Plan 02 changes; no errors exist in the orders directory

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- The worktree branch did not include Plan 01 commits from main — resolved by merging main into the worktree branch before executing (fast-forward merge, no conflicts).

## Known Stubs

- `supabase` client declared in `OrdersClient` but subscription not wired — intentional scaffold for Phase 22 Realtime subscription (not a rendering stub; it does not affect current UI correctness)

## Next Phase Readiness

- KDS-01 through KDS-05 all satisfied by Plans 01 and 02 together
- Phase 22 (Realtime + Per-Item Notes) can proceed — the `supabase` client scaffold and `setOrders` state are ready for realtime subscription wiring

## Self-Check: PASSED

- `src/app/(admin)/orders/OrdersClient.tsx` — exists, verified (79 lines added)
- commit `3ab1b9b` — verified in git log
- `KDS_VIEW_KEY` at line 38 — verified
- `localStorage.getItem` in useEffect at line 125 — verified
- `localStorage.setItem` in toggleView at line 131 — verified
- `LayoutGrid` and `List` imported at line 7 — verified
- `view === 'grid'` conditional at line 180 — verified
- No `typeof window` guard — verified (grep returned empty)
- No `setLoading(` calls — verified (grep returned empty)
- `setLoadingId` at 3 locations (declare, set, reset) — verified

---
*Phase: 21-kds-dashboard*
*Completed: 2026-05-08*
