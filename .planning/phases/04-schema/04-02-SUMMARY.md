---
phase: 04-schema
plan: 02
subsystem: database
tags: [typescript, types, orders, product-options, v1.1]

# Dependency graph
requires:
  - phase: 04-schema
    plan: 01
    provides: "SQL migration 021 adding product_option_groups, product_options, altering orders/order_items"
provides:
  - "TypeScript Order interface with new status union (pending/preparing/ready/done/cancelled) and notes field"
  - "TypeScript OrderItem interface with selected_options: Record<string, unknown> | null"
  - "OptionGroupType union type exported from database.ts"
  - "PriceRule union type exported from database.ts"
  - "ProductOptionGroup interface exported from database.ts"
  - "ProductOption interface exported from database.ts"
affects:
  - "05-cart"
  - "06-order-api"
  - "07-order-ui"
  - "Any phase that imports Order, OrderItem, ProductOptionGroup, or ProductOption from @/types/database"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Union types exported alongside interfaces for structured constraint types (OptionGroupType, PriceRule)"
    - "OptionGroupType = 'single' | 'multiple' | 'half_and_half' mirrors DB CHECK constraint"
    - "PriceRule = 'max' | 'average' | 'sum' | 'fixed' mirrors DB CHECK constraint"

key-files:
  created: []
  modified:
    - "src/types/database.ts"
    - "src/app/(admin)/orders/OrdersClient.tsx"
    - "src/app/api/orders/[id]/route.ts"

key-decisions:
  - "Order.status union: 'pending' | 'preparing' | 'ready' | 'done' | 'cancelled' — mirrors kitchen workflow, no 'confirmed'/'completed'"
  - "base_price: number | null (absolute option price for sizes/half-and-half); price_modifier: number (additive delta for toppings)"
  - "translations: Record<string, { name?: string }> — consistent with existing Category/Product/Menu pattern"

patterns-established:
  - "Status union in TypeScript must match DB CHECK constraint exactly — TypeScript 'confirmed'/'completed' removed in sync with SQL migration"
  - "New table interfaces exported alongside union types for their TEXT+CHECK columns"

requirements-completed: [ORD-01, ORD-02, ORD-03, ORD-04]

# Metrics
duration: 8min
completed: 2026-05-06
---

# Phase 04 Plan 02: Schema — TypeScript Types Summary

**TypeScript database.ts extended with v1.1 order types: updated Order/OrderItem interfaces + new ProductOptionGroup, ProductOption, OptionGroupType, PriceRule exports**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-06T13:10:00Z
- **Completed:** 2026-05-06T13:18:00Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Updated `Order.status` union from old v1.0 values to v1.1 kitchen workflow: `'pending' | 'preparing' | 'ready' | 'done' | 'cancelled'`
- Added `Order.notes: string | null` field to match DB column added in migration 021
- Added `OrderItem.selected_options: Record<string, unknown> | null` field to match DB JSONB column
- Added `OptionGroupType` and `PriceRule` union type exports matching DB CHECK constraints
- Added `ProductOptionGroup` and `ProductOption` interfaces with all required fields and correct nullability
- Build passes with zero TypeScript errors (`npm run build` exits 0)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update src/types/database.ts with v1.1 types** - `42a58c2` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/types/database.ts` - Updated Order, OrderItem interfaces; added OptionGroupType, PriceRule, ProductOptionGroup, ProductOption exports
- `src/app/(admin)/orders/OrdersClient.tsx` - Updated status colors and workflow buttons to v1.1 status values
- `src/app/api/orders/[id]/route.ts` - Updated validStatuses array to v1.1 values

## Decisions Made

- Used `Record<string, { name?: string }>` for `translations` on both new interfaces — consistent with existing Category, Product, Menu interfaces in same file
- `base_price: number | null` (nullable) and `price_modifier: number` (non-nullable with default 0) — intentionally distinct: base_price is absolute price (for pizza sizes/half-and-half), price_modifier is additive delta (for toppings)
- Exported `OptionGroupType` and `PriceRule` as separate union types (not inline) — enables reuse in future phases and matches existing `UserRole`/`Plan` pattern in the file

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated OrdersClient.tsx status comparisons and buttons to v1.1 values**
- **Found during:** Task 1 (build verification after updating database.ts)
- **Issue:** `OrdersClient.tsx` compared `selectedOrder.status` against `'confirmed'` and `'completed'` (old values) — TypeScript error blocked build
- **Fix:** Updated `statusColors` record to include `preparing/ready/done` with appropriate colors; updated action buttons workflow to `pending→preparing→ready→done` with correct labels
- **Files modified:** `src/app/(admin)/orders/OrdersClient.tsx`
- **Verification:** Build passes — TypeScript no longer sees type overlap error
- **Committed in:** `42a58c2` (Task 1 commit)

**2. [Rule 1 - Bug] Updated orders PATCH route validStatuses to v1.1 values**
- **Found during:** Task 1 (grep scan after fixing OrdersClient.tsx)
- **Issue:** `src/app/api/orders/[id]/route.ts` validated status against `['pending', 'confirmed', 'completed', 'cancelled']` — runtime rejections would occur for any `preparing/ready/done` status update from the UI
- **Fix:** Updated `validStatuses` to `['pending', 'preparing', 'ready', 'done', 'cancelled']`
- **Files modified:** `src/app/api/orders/[id]/route.ts`
- **Verification:** No TypeScript error (string array); confirmed correct values match new union type
- **Committed in:** `42a58c2` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both auto-fixes were necessary for correctness — the type update would have left the admin UI and PATCH route using stale status values that would fail at runtime. No scope creep.

## Issues Encountered

None — all issues were anticipated by the plan (Pitfall 5 in RESEARCH.md: TypeScript status union out of sync with DB constraint) and auto-fixed.

## User Setup Required

None - this plan is TypeScript-only. No environment variables or external services required.

## Next Phase Readiness

- All four v1.1 table types are now correct in TypeScript
- `ProductOptionGroup` and `ProductOption` interfaces ready for phases 5–8 to import
- `OptionGroupType` and `PriceRule` union types available for cart/order-api code
- `Order.status` union is now consistent with both the DB constraint (migration 021) and the admin UI/API

---
*Phase: 04-schema*
*Completed: 2026-05-06*
