---
phase: 22-realtime-per-item-notes
plan: 01
subsystem: ui
tags: [kds, orders, supabase-realtime, polling, react-hooks, lucide-react, tailwind, migration]

# Dependency graph
requires:
  - phase: 21-kds-dashboard
    provides: OrdersClient.tsx with supabase client scaffolded, setOrders state, OrderCard items list, admin modal items list
provides:
  - Migration 025 SQL file with item_notes_enabled flag, order_items.notes column, ALTER PUBLICATION for Realtime
  - TenantSettings.item_notes_enabled: boolean in database.ts
  - Realtime postgres_changes subscription on orders table (channel per tenantId, follow-up items query, removeChannel cleanup)
  - 15s polling fallback via setInterval fetch to /api/orders
  - Per-item notes display in OrderCard (MessageSquare icon + italic) when item.notes is non-null
  - Per-item notes display in admin list-view modal with same icon + italic treatment
affects: [22-02-plan]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Realtime INSERT handler: follow-up select('*, order_items(*)') because postgres_changes payload excludes joins (Pitfall 1)"
    - "Dual subscription pattern: Realtime (instant) + polling at 15s (safety net) running simultaneously"
    - "Idempotent Realtime handler: prev.some(o => o.id === fullOrder.id) guard prevents duplicate entries"
    - "supabase client at component top level (not in useEffect) — createBrowserClient memoizes, stable reference (Pitfall 2)"
    - "Channel name orders-realtime-${tenantId} ensures uniqueness per tenant across browser tabs (Pitfall 3)"

key-files:
  created:
    - supabase/migrations/025_notes_and_realtime.sql
  modified:
    - src/types/database.ts
    - src/app/(admin)/orders/OrdersClient.tsx

key-decisions:
  - "Run Realtime and polling simultaneously — Realtime for instant updates, polling at 15s as safety net covering status changes and gaps"
  - "Follow-up query on INSERT payload.new.id fetches full order+items — avoids empty items list on new KDS cards (Pitfall 1)"
  - "Polling setOrders(data.orders) does full state replacement — correct for deletions and status refreshes"
  - "Migration 025 applied manually via Supabase SQL Editor (local Docker not available — consistent with all prior migrations)"

patterns-established:
  - "Pattern: Realtime useEffect with removeChannel cleanup + separate polling useEffect with clearInterval cleanup"
  - "Pattern: MessageSquare size={10} + italic span for per-item notes, consistent between OrderCard and admin modal"

requirements-completed: [KDS-06, NOTE-04]

# Metrics
duration: 4min
completed: 2026-05-08
---

# Phase 22 Plan 01: Realtime + Per-Item Notes Display Summary

**Supabase Realtime postgres_changes subscription + 15s polling fallback wired into OrdersClient, with migration 025 adding order_items.notes and item_notes_enabled flag, and per-item notes rendered with MessageSquare icon and italic styling in both KDS card and admin modal**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-08T12:41:36Z
- **Completed:** 2026-05-08T12:46:04Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `supabase/migrations/025_notes_and_realtime.sql` with three SQL statements: `ADD COLUMN item_notes_enabled BOOLEAN NOT NULL DEFAULT false` on tenant_settings, `ADD COLUMN notes TEXT` on order_items, `ALTER PUBLICATION supabase_realtime ADD TABLE orders`
- Extended `TenantSettings` interface in `src/types/database.ts` with `item_notes_enabled: boolean` (NOTE-01)
- Added Realtime `useEffect` to `OrdersClient.tsx`: subscribes to `postgres_changes` INSERT on `orders` table filtered by `tenant_id=eq.${tenantId}`, fires follow-up `select('*, order_items(*)')` query to get full order including items, uses idempotent `prev.some()` guard, calls `supabase.removeChannel(channel)` on cleanup (KDS-06)
- Added polling `useEffect` with `setInterval(15_000)` fetching `/api/orders?tenant_id=${tenantId}` and replacing full state; `clearInterval` cleanup (KDS-06 fallback)
- Updated `OrderCard` items list: each `<li>` is now a flex column showing item name + conditional notes span with `MessageSquare size={10}` icon and italic class (NOTE-04)
- Updated admin modal items: notes span added after selected_options with identical MessageSquare + italic treatment (NOTE-04)

## Task Commits

1. **Task 1: Migration 025 + TenantSettings.item_notes_enabled** - `1eb7b59` (feat)
2. **Task 2: Realtime subscription + polling + notes display** - `3ba33fc` (feat)

## Files Created/Modified

- `supabase/migrations/025_notes_and_realtime.sql` — New migration: item_notes_enabled flag, order_items.notes column, ALTER PUBLICATION for Realtime
- `src/types/database.ts` — TenantSettings extended with `item_notes_enabled: boolean` at line 32
- `src/app/(admin)/orders/OrdersClient.tsx` — MessageSquare import; Realtime useEffect; polling useEffect; OrderCard notes display; admin modal notes display

## Manual Step Required

Migration 025 must be applied manually via the Supabase SQL Editor:
1. Open https://supabase.com/dashboard/project/ktogbpqookfcqilqvici/sql/new
2. Paste the contents of `supabase/migrations/025_notes_and_realtime.sql`
3. Click "Run"
4. Confirm no errors
5. Go to Database > Replication and verify `orders` table appears under `supabase_realtime` publication

## Decisions Made

- Run both Realtime and polling simultaneously rather than a conditional fallback — avoids needing error-detection logic; polling at 15s is light enough to run always and handles edge cases Realtime might miss (status changes, reconnect gaps)
- Follow-up query on `payload.new.id` (Option A from research) — kitchen staff must see items immediately on new KDS cards; accepting empty items list until next poll would be wrong UX
- `supabase` client stays at component top level — `createBrowserClient` memoizes internally, so the reference is stable across renders; moving it into `useEffect` would break the linting rule about missing deps and create new client instances unnecessarily

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all delivery criteria for this plan are fully wired. The `item_notes_enabled` flag is in the DB schema and TypeScript type; its use in the customer-facing textarea and store settings toggle is Plan 02 scope.

## Self-Check: PASSED

- `supabase/migrations/025_notes_and_realtime.sql` — exists, verified
- `src/types/database.ts` — `item_notes_enabled: boolean` at line 32, verified
- `src/app/(admin)/orders/OrdersClient.tsx` — Realtime channel `orders-realtime-${tenantId}` at line 140, `removeChannel` at line 168, `15_000` at line 180, `MessageSquare` at lines 7/84/335, `item.notes` display in both OrderCard and modal — verified
- commit `1eb7b59` — verified in git log
- commit `3ba33fc` — verified in git log
- `npx tsc --noEmit` — passed with no errors
