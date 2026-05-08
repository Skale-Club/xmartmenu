---
phase: 27-filter-chips-sound
plan: 01
subsystem: ui, kds
tags: [kds, filter-chips, web-audio, localStorage, react, typescript]

# Dependency graph
requires:
  - phase: 26-schema-settings
    provides: amberThreshold/redThreshold prop threading, useElapsedTime parameterised, OrdersClient baseline
provides:
  - KDS-10: Four status filter chips (Pendentes/Em preparo/Prontos/Todos); default pending; local filter
  - KDS-11: Active filter persisted to kds_filter_{tenantId} in localStorage; restored on mount
  - KDS-12: Web Audio API beep on new pending Realtime INSERT; respects muted state via mutedRef
  - KDS-13: Bell/BellOff mute button; muted persisted to kds_mute_{tenantId} in localStorage
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mutedRef mirrors muted state: Realtime closure reads current muted value without re-subscribing (avoids stale closure)"
    - "AudioContext created lazily on first playBeep() call: satisfies browser autoplay policy"
    - "useRef for AudioContext: persists across renders without triggering re-render"
    - "filteredOrders derived from orders + activeFilter: local filter with no server round-trip"

key-files:
  created:
    - .planning/phases/27-filter-chips-sound/27-01-PLAN.md
  modified:
    - src/app/(admin)/orders/OrdersClient.tsx

key-decisions:
  - "DEFAULT_FILTER='pending' (not array): chips are mutually exclusive; single active filter matches v1.8 Roadmap decision"
  - "mutedRef synced via useEffect(,[muted]): avoids re-subscribing Realtime channel on every mute toggle"
  - "playBeep() fires only for status==='pending' on INSERT: status updates are not INSERT events in Supabase Realtime"
  - "AudioContext created lazily inside playBeep(): browser autoplay policy requires user interaction before creation"
  - "filteredOrders count shown as 'N / Total' when filtered, 'Total' when showing all: contextual header count"

requirements-completed: [KDS-10, KDS-11, KDS-12, KDS-13]

# Metrics
duration: ~3min
completed: 2026-05-08
---

# Phase 27 Plan 01: Filter Chips + Sound Summary

**KDS filter chips (4 states, mutually exclusive, default pending) + Web Audio beep on new orders + Bell mute button — all persisted per-tenant in localStorage.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-08T17:58:51Z
- **Completed:** 2026-05-08T18:01:47Z
- **Tasks:** 2 completed (shipped together in 1 commit — tightly coupled changes in same file)
- **Files modified:** 1

## Accomplishments

- KDS-10: Four filter chips render above the card grid/list — Pendentes, Em preparo, Prontos, Todos. Default shows pending orders only. Filter applied locally over loaded orders state without server round-trip. Done/cancelled hidden by default.
- KDS-11: Active chip persisted to `kds_filter_{tenantId}` in localStorage via `selectFilter()`. Restored on mount via SSR-safe `useEffect` (same pattern as `kds_view_{tenantId}`).
- KDS-12: `playBeep()` creates `AudioContext` lazily (browser autoplay policy), generates a 880Hz sine wave with 0.1s exponential decay. Called on Realtime INSERT when new order has `status==='pending'` and `!mutedRef.current`. `mutedRef` mirrors `muted` state so the Realtime closure reads current value without re-subscribing.
- KDS-13: `Bell`/`BellOff` from lucide-react toggles `muted` state and persists to `kds_mute_{tenantId}` in localStorage. Icon in KDS header alongside view toggle.
- Count display shows `N / Total` when filter is active (e.g. "3 / 12 pedido(s)") or just `Total` when all orders are shown.
- Empty state distinguishes "Nenhum pedido ainda" (no orders at all) from "Nenhum pedido com este filtro" (filter active, no match).

## Task Commits

1. **Task 1 + 2: Filter chips + mute button + sound alert (KDS-10, KDS-11, KDS-12, KDS-13)** - `9cf4191` (feat)

## Files Created/Modified

- `src/app/(admin)/orders/OrdersClient.tsx` — added `KDS_FILTER_KEY`, `KDS_MUTE_KEY`, `FilterValue` type, `FILTER_CHIPS` constant, `DEFAULT_FILTER`; added `activeFilter`, `muted`, `audioCtxRef`, `mutedRef` state/refs; 3 SSR-safe useEffects for persistence; `playBeep()` function; `selectFilter()` and `toggleMute()` helpers; `filteredOrders` derivation; filter chip row in JSX; Bell/BellOff mute button in header; updated grid/list to use `filteredOrders`

## Decisions Made

- `DEFAULT_FILTER='pending'` (not an array): chips are mutually exclusive per v1.8 Roadmap decision
- `mutedRef` synced via `useEffect([muted])`: avoids re-subscribing Realtime channel on every mute toggle
- `playBeep()` fires only for `status==='pending'` on INSERT: status updates arrive as UPDATE events, not INSERT
- `AudioContext` created lazily inside `playBeep()`: browser autoplay policy requires user gesture before creation
- Tasks 1 and 2 shipped in same commit: both changes are in the same file and are tightly coupled (beep respects filter-adjacent mute state)

## Deviations from Plan

None — plan executed exactly as written. Tasks 1 and 2 shipped in a single commit because the AudioContext/mutedRef changes and the filter chip changes are in the same file and interleave (mutedRef must be declared before the Realtime effect that uses it, which is adjacent to the filter state declarations).

## Known Stubs

None.

## Self-Check: PASSED

- `src/app/(admin)/orders/OrdersClient.tsx` KDS_FILTER_KEY: FOUND
- `src/app/(admin)/orders/OrdersClient.tsx` KDS_MUTE_KEY: FOUND
- `src/app/(admin)/orders/OrdersClient.tsx` FILTER_CHIPS: FOUND
- `src/app/(admin)/orders/OrdersClient.tsx` playBeep: FOUND
- `src/app/(admin)/orders/OrdersClient.tsx` mutedRef: FOUND
- `src/app/(admin)/orders/OrdersClient.tsx` filteredOrders: FOUND
- `src/app/(admin)/orders/OrdersClient.tsx` Bell: FOUND (import)
- Commit `9cf4191`: FOUND
- `npx tsc --noEmit`: 0 errors
