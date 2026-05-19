---
phase: 38-order-types-admin-schema
plan: "02"
subsystem: admin-ui
tags: [react, typescript, supabase, store-settings, order-types]

# Dependency graph
requires:
  - "38-01: migration 034 schema (5 new columns on tenant_settings)"
provides:
  - "Order Types section in StoreClient.tsx: three toggles + conditional fields"
  - "All-off validation guard in handleSave"
  - "5 new fields wired into existing Supabase upsert via ...form spread"
affects:
  - 39 (customer order flows — reads dine_in_enabled/pickup_enabled/delivery_enabled at checkout)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional render pattern: {form.pickup_enabled && <div>...} for ETA and fee fields"
    - "Cents/dollars conversion: value=(cents/100).toFixed(2), onChange=Math.round(dollars*100)"
    - "Toggle row reuse: identical className structure to existing item_notes_enabled toggle"

key-files:
  created: []
  modified:
    - src/app/(admin)/settings/store/StoreClient.tsx
    - src/types/database.ts

key-decisions:
  - "Insertion-only approach: new Order Types card inserted between Operations and Custom Domain without touching any surrounding code"
  - "Delivery fee cents/dollars split: form state stores cents (integer), UI displays dollars (decimal string via toFixed(2))"
  - "All-off guard positioned after KDS threshold validation — same setError+return pattern"
  - "UtensilsCrossed chosen over ShoppingBag to distinguish from existing ShoppingCart on Operations section"

# Metrics
duration: 5min
completed: 2026-05-19
---

# Phase 38 Plan 02: Order Types Admin UI Summary

**Order Types section added to StoreClient.tsx — three independent toggles (Dine-In, Pick-Up, Delivery), conditional ETA and fee fields, all-off validation, and 5 new fields wired into the existing upsert call via ...form spread.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-19T15:21:00Z
- **Completed:** 2026-05-19T15:26:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `form` useState with 5 new fields: `dine_in_enabled`, `pickup_enabled`, `delivery_enabled`, `pickup_eta_minutes`, `delivery_fee_cents`
- Added `UtensilsCrossed` to lucide-react import
- Added all-off validation guard in `handleSave` (blocks upsert when all three toggles are off, shows "At least one order type must be active.")
- Inserted Order Types section card in the left column between the Operations/KDS card and the Custom Domain card
- Three toggle rows using exact existing `item_notes_enabled` toggle pattern
- Conditional pick-up ETA field (appears only when `pickup_enabled === true`)
- Conditional delivery fee field with cents/dollars conversion (appears only when `delivery_enabled === true`)
- No upsert call changes needed — `...form` spread automatically includes all 5 new fields

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend form state, add validation guard, and wire 5 fields into upsert** - `80fcef8` (feat)
2. **Task 2: Render the Order Types section card between Operations and Custom Domain** - `5eb254e` (feat)

## Files Created/Modified

- `src/app/(admin)/settings/store/StoreClient.tsx` — Order Types section card, form state extension, UtensilsCrossed import, all-off validation
- `src/types/database.ts` — TenantSettings interface extended with 5 order-type fields (deviation fix)

## Decisions Made

- Insertion-only approach: new Order Types card inserted between Operations and Custom Domain without touching any surrounding code
- Delivery fee stored as cents in form state; UI displays dollars via `(form.delivery_fee_cents / 100).toFixed(2)` and converts back via `Math.round(Number(e.target.value) * 100)`
- All-off guard positioned after KDS threshold validation, using same `setError + setLoading(false) + return` pattern
- `UtensilsCrossed` chosen over `ShoppingBag` — visually distinct from existing `ShoppingCart` on Operations section

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added 5 order-type fields to TenantSettings in worktree database.ts**
- **Found during:** Task 1
- **Issue:** The worktree branch `worktree-agent-a303ce10d9d1b027e` diverged from `main` before Plan 01's `62ee895` commit. The `src/types/database.ts` in the worktree was missing the 5 new fields (`dine_in_enabled`, `pickup_enabled`, `delivery_enabled`, `pickup_eta_minutes`, `delivery_fee_cents`) required for TypeScript compilation.
- **Fix:** Applied the same 5-field addition to `src/types/database.ts` in the worktree, matching the diff from Plan 01's commit.
- **Files modified:** `src/types/database.ts`
- **Commit:** `80fcef8` (included alongside Task 1 changes)

## Known Stubs

None — all toggle values are wired to actual Supabase upsert. ETA and fee inputs are real form fields. No placeholder data that flows to UI rendering.

## TypeScript Verification

`npx tsc --noEmit` completed with exit code 0. The 2 pre-existing `Instagram` icon errors in `BrandingClient.tsx` and `MenuPage.tsx` are out-of-scope (pre-existing, unrelated to this plan).

## Next Phase Readiness

- Order Types admin UI is complete — restaurant admin can set dine-in/pick-up/delivery modes and configure ETA/fee
- Phase 39 (customer order flows) can now read `dine_in_enabled`, `pickup_enabled`, `delivery_enabled` at checkout to gate order placement

---
*Phase: 38-order-types-admin-schema*
*Completed: 2026-05-19*
