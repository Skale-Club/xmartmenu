---
phase: 22-realtime-per-item-notes
plan: 02
subsystem: ui
tags: [menu, cart, orders, tailwind, supabase, typescript, sanitization, notes]

# Dependency graph
requires:
  - phase: 22-01
    provides: Migration 025 with order_items.notes column, item_notes_enabled flag in TenantSettings

provides:
  - item_notes_enabled toggle UI in StoreClient.tsx (admin Store Settings → Ordering section)
  - CartItem.note field carrying per-item note through the cart
  - ProductModal textarea gated by itemNotesEnabled prop with PT-BR label and 140-char limit
  - submitOrder items mapping passes notes: item.note || undefined in POST body
  - sanitizeNote helper in orders POST route: strips control chars, trims, caps at 140

affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "itemNotesEnabled prop pattern: boolean gate controls conditional textarea render inside ProductModal"
    - "note flows as 4th arg through addToCart → CartItem.note → submitOrder → API sanitizeNote → DB"
    - "sanitizeNote strips \\x00-\\x08\\x0B-\\x1F\\x7F (keep tab/newline), trims, caps at 140 chars server-side"
    - "itemNote state resets in useEffect([product.id]) to prevent stale note on new product open (Pitfall 6)"
    - "note is metadata on CartItem, excluded from buildCartKey — same product+options share cart slot (Pitfall 7)"

key-files:
  created: []
  modified:
    - src/app/(admin)/settings/store/StoreClient.tsx
    - src/components/menu/MenuPage.tsx
    - src/app/api/orders/route.ts
    - src/types/database.ts

key-decisions:
  - "item_notes_enabled added to StoreClient form state and upserted via ...form spread — no separate handleSave change needed"
  - "note excluded from buildCartKey — re-adding same product+options replaces note on existing slot (same cart behavior)"
  - "sanitizeNote strips control chars server-side even though client-side maxLength=140 guards — defense in depth"
  - "item_notes_enabled: boolean added to TenantSettings type locally — worktree diverged from main which had Plan 01 changes"

patterns-established:
  - "Pattern: Per-item note flows as optional 4th arg from ProductModal.onAddToCart → addToCart → CartItem.note → submitOrder.notes → API"

requirements-completed: [NOTE-01, NOTE-02, NOTE-03]

# Metrics
duration: 3min
completed: 2026-05-08
---

# Phase 22 Plan 02: Admin Toggle + Customer Textarea + API Sanitization Summary

**item_notes_enabled toggle in Store Settings, customer Observações textarea in ProductModal gated by the flag, full cart-to-API-to-DB note flow with server-side sanitizeNote validation**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-08T12:49:59Z
- **Completed:** 2026-05-08T12:53:56Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `item_notes_enabled` to `StoreClient.tsx` form state (defaults to `settings?.item_notes_enabled ?? false`) with an "Ordering" section containing a toggle button; flag included in upsert via `...form` spread automatically
- Extended `CartItem` interface with `note?: string` (excluded from `buildCartKey`); updated `addToCart` to accept 4th `note` arg with existing-slot note replacement
- Updated `submitOrder` items mapping to include `notes: item.note || undefined` in POST body (NOTE-02)
- Added `itemNotesEnabled?: boolean` prop to `ProductModal`; added `itemNote` state that resets in `useEffect([product.id])` (Pitfall 6); textarea renders conditionally with PT-BR label "Observações", `maxLength={140}`, live counter `{itemNote.length}/140`
- Updated `Add to cart` button onClick to pass `itemNote || undefined` as 3rd arg; updated call site to forward `note` in `onAddToCart`
- Added `sanitizeNote` helper to `src/app/api/orders/route.ts` stripping control chars `\x00-\x08\x0B-\x1F\x7F`, trimming, capping at 140; applied via `sanitizeNote(item.notes)` in orderItems mapping (NOTE-03)
- Fixed `TenantSettings` type missing `item_notes_enabled: boolean` (Plan 01 changes were on main branch not merged into this worktree)

## Task Commits

1. **Task 1: Add item_notes_enabled toggle to StoreClient.tsx** - `8d020cb` (feat)
2. **Task 2: Add notes textarea to ProductModal + wire cart and API** - `eba7630` (feat)

## Files Created/Modified

- `src/app/(admin)/settings/store/StoreClient.tsx` — item_notes_enabled in form state, Ordering section with toggle button
- `src/components/menu/MenuPage.tsx` — CartItem.note, addToCart 4th arg, submitOrder notes mapping, ProductModal textarea gated by itemNotesEnabled, itemNote state/reset, call site updates
- `src/app/api/orders/route.ts` — sanitizeNote helper function, applied to orderItems mapping
- `src/types/database.ts` — item_notes_enabled: boolean added to TenantSettings interface (deviation)

## Decisions Made

- item_notes_enabled added to `form` state in StoreClient and upserted via `...form` spread — the existing handleSave pattern handles it without modification
- note is stored as metadata on CartItem and excluded from buildCartKey — re-adding same product+options combination replaces the note on the existing cart slot (consistent with Pitfall 7 pattern)
- sanitizeNote applied server-side even though the client enforces maxLength=140 — defense in depth against malformed or direct API requests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added item_notes_enabled: boolean to TenantSettings type**
- **Found during:** Task 2 (TypeScript build check after MenuPage and StoreClient changes)
- **Issue:** TypeScript error TS2339: `Property 'item_notes_enabled' does not exist on type 'TenantSettings'`. Plan 01 commits that added this field to `database.ts` were on the `main` branch but had not been merged into this worktree's branch (worktree started from `4a5df3e` before Plan 01 executed)
- **Fix:** Added `item_notes_enabled: boolean  // NOTE-01: added in migration 025` to TenantSettings interface in `src/types/database.ts`
- **Files modified:** src/types/database.ts
- **Verification:** `npx tsc --noEmit` passed with zero errors after fix
- **Committed in:** `eba7630` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was necessary to unblock TypeScript compilation. The change is consistent with what Plan 01 already landed on main — this worktree simply needed to match that type definition.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None — no external service configuration required for this plan. The migration 025 that added `order_items.notes` and `item_notes_enabled` was handled in Plan 01.

## Known Stubs

None — the feature is fully wired:
- Admin can toggle `item_notes_enabled` in Store Settings and it persists to DB
- Customer sees textarea in ProductModal only when `item_notes_enabled` is true
- Note flows through cart → POST body → server sanitization → DB insert
- KDS display of notes was implemented in Plan 01 (OrderCard + admin modal)

## Next Phase Readiness

Phase 22 is complete. All requirements NOTE-01, NOTE-02, NOTE-03, KDS-06 (Plan 01), NOTE-04 (Plan 01) are satisfied.

Manual prerequisite before testing end-to-end: Migration 025 must be applied to the Supabase project (handled in Plan 01 scope — see Plan 01 SUMMARY for SQL Editor steps).

---
*Phase: 22-realtime-per-item-notes*
*Completed: 2026-05-08*
