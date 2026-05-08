---
phase: 21-kds-dashboard
plan: 01
subsystem: ui
tags: [kds, orders, react-hooks, tailwind, interval, elapsed-time]

# Dependency graph
requires:
  - phase: 08-tenant-orders-view
    provides: OrdersClient.tsx with updateStatus logic and orders table view
provides:
  - useElapsedTime hook with 30s interval, amber/red thresholds (10min/20min)
  - STATUS_COLORS constant with correct pending=blue, preparing=yellow mapping
  - OrderCard component with elapsed-time chip and advance/cancel actions
  - Responsive card grid layout (1/2/3 columns) replacing the table view
  - tenantId prop wired from page.tsx to OrdersClient
affects: [21-02-plan, 22-realtime-per-item-notes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useRef for interval ID (avoids extra renders on timer storage)
    - lazy useState initializer for SSR-safe initial time computation
    - STATUS_COLORS with full literal Tailwind class strings (no interpolation, Tailwind CSS 4 purge safe)
    - loadingId: string | null pattern for per-card loading state (replaces global loading: boolean)

key-files:
  created:
    - src/app/(admin)/orders/useElapsedTime.ts
  modified:
    - src/app/(admin)/orders/OrdersClient.tsx
    - src/app/(admin)/orders/page.tsx

key-decisions:
  - "STATUS_COLORS.pending=blue, preparing=yellow — corrects the previous inverted color mapping"
  - "loadingId: string | null replaces loading: boolean to allow per-card disabled state without blocking all cards"
  - "view state and supabase client scaffolded now; wired in Plan 02 (toggle) and Phase 22 (realtime)"
  - "useRef for intervalRef avoids spurious renders when storing the timer ID"

patterns-established:
  - "Pattern: useElapsedTime(createdAt) — lazy initializer + setInterval(30_000) + clearInterval cleanup"
  - "Pattern: STATUS_COLORS record with {border, bg, badge, label} — drives all card color surfaces from one dict"

requirements-completed: [KDS-01, KDS-02, KDS-03]

# Metrics
duration: 3min
completed: 2026-05-08
---

# Phase 21 Plan 01: KDS Foundation Summary

**KDS card grid with useElapsedTime hook, corrected STATUS_COLORS (pending=blue, preparing=yellow), OrderCard component, and responsive 1/2/3-column layout replacing the orders table**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-08T12:08:23Z
- **Completed:** 2026-05-08T12:11:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `useElapsedTime.ts` — custom hook with 30s `setInterval`, `clearInterval` cleanup, amber (10min) and red (20min) chip classes as full literal Tailwind strings
- Rewrote `OrdersClient.tsx` — replaced `statusColors` with `STATUS_COLORS` (corrected color swap), added `OrderCard` component, replaced table with responsive card grid
- Updated `page.tsx` — passes `tenantId` prop to `OrdersClient` (required by Plan 02 localStorage wiring)

## Task Commits

1. **Task 1: Create useElapsedTime hook** - `b09cc9c` (feat)
2. **Task 2: Add STATUS_COLORS, OrderCard, grid layout, tenantId prop** - `d625147` (feat)

## Files Created/Modified

- `src/app/(admin)/orders/useElapsedTime.ts` — New hook: `useElapsedTime(createdAt)` → `{ minutes, chipClass }`; 30s interval with cleanup
- `src/app/(admin)/orders/OrdersClient.tsx` — Replaced table view with card grid; added `STATUS_COLORS`, `OrderCard`, `NEXT_STATUS`, `ADVANCE_LABEL`; `loadingId` pattern
- `src/app/(admin)/orders/page.tsx` — Added `tenantId={tenantId}` prop to `<OrdersClient />`

## Decisions Made

- `STATUS_COLORS.pending = blue`, `preparing = yellow` — fixes the inverted mapping from the original `statusColors` dict (which had pending=yellow, preparing=blue — inconsistent with kitchen workflow where "pending" orders are new/waiting)
- `loadingId: string | null` replaces `loading: boolean` — allows individual card disabled state, multiple cards don't block each other
- `view` state and `supabase` client scaffolded now, not wired yet — Plan 02 adds localStorage persistence for view toggle, Phase 22 adds realtime subscription

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

- `view` state declared but toggle UI not rendered — intentional, Plan 02 adds the `<LayoutGrid>/<List>` toggle button
- `supabase` client declared but subscription not wired — intentional, Phase 22 adds Realtime subscription
- `tenantId` prop accepted but not consumed yet — intentional, Plan 02 uses it for `localStorage` key scoping

These stubs are by-design scaffolding per the plan spec (not data stubs that affect rendering correctness).

## Self-Check: PASSED

- `src/app/(admin)/orders/useElapsedTime.ts` — exists, verified
- `src/app/(admin)/orders/OrdersClient.tsx` — exists, verified
- `src/app/(admin)/orders/page.tsx` — exists, verified
- commit `b09cc9c` — verified in git log
- commit `d625147` — verified in git log
