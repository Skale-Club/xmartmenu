---
phase: 07-checkout
plan: 01
subsystem: api
tags: [orders, selected_options, jsonb, order_items]

# Dependency graph
requires:
  - phase: 06-public-menu-option-selectors-cart
    provides: CartItem.selectedOptions populated per cart item before submission

provides:
  - selected_options field accepted and persisted in POST /api/orders per order item

affects:
  - 07-02 (checkout confirmation UI reads order_items with selected_options)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pass selected_options from request body directly into order_items insert as nullable JSONB"

key-files:
  created: []
  modified:
    - src/app/api/orders/route.ts

key-decisions:
  - "selected_options typed as Record<string, unknown> to match DB column type in database.ts"
  - "Use || null fallback so missing selected_options does not break existing callers"

patterns-established:
  - "optional JSONB fields use `item.field || null` pattern in order_items map"

requirements-completed:
  - ORD-19

# Metrics
duration: 4min
completed: 2026-05-06
---

# Phase 7 Plan 01: Checkout Summary

**`selected_options` accepted in POST /api/orders and persisted to `order_items` table so cart option selections are no longer dropped**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-06T16:27:00Z
- **Completed:** 2026-05-06T16:31:40Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `selected_options?: Record<string, unknown>` to `OrderItem` interface
- Passed `item.selected_options || null` in `orderItems` map so each DB row gets the full option selection
- Build passes with no TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add selected_options to OrderItem interface and DB insert** - `10cdd0d` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/app/api/orders/route.ts` - OrderItem interface + orderItems map updated with selected_options

## Decisions Made

- `selected_options` typed as `Record<string, unknown>` — matches `order_items.selected_options` column type in `src/types/database.ts`
- `|| null` fallback preserves backward compatibility for callers that omit the field

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- API now accepts and persists `selected_options` per order item
- Phase 07-02 (checkout UI / confirmation) can rely on the DB containing full option selections for each item

---
*Phase: 07-checkout*
*Completed: 2026-05-06*
