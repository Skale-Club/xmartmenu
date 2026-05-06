---
phase: 05-admin-product-options-ui
plan: "03"
subsystem: ui
tags: [react, supabase, inline-forms, option-groups, product-options, reorder]

requires:
  - phase: 05-02
    provides: ProductDetailClient.tsx shell with placeholder stubs for Plan 03

provides:
  - OptionGroupForm sub-component with name/type/required/min_selections/max_selections fields
  - OptionForm sub-component with adaptive price field (D-07 compliant)
  - handleSaveGroup — insert/update product_option_groups via Supabase client
  - handleSaveOption — insert/update product_options via Supabase client
  - moveGroup — optimistic position swap for groups with Supabase persistence
  - moveOption — optimistic position swap for options with Supabase persistence
  - Zero remaining placeholder stubs in ProductDetailClient.tsx

affects: [06-public-menu-display, cart-feature]

tech-stack:
  added: []
  patterns:
    - inline-expand-form with per-form saving/error state
    - optimistic-reorder with setReorderInFlight guard and silent restore on error
    - adaptive-price-field driven by parentGroupType prop (D-07)
    - throw-error-pattern for async mutation error propagation from child form to handler

key-files:
  created: []
  modified:
    - src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx

key-decisions:
  - "Implemented both tasks atomically in one commit since both tasks modify the same file and cannot be meaningfully split"
  - "Used _tenantId (renamed prop) for Supabase inserts — matches ProductDetailClient.tsx Props interface"
  - "Removed void cn suppressor since cn is now unused — import removed to avoid lint error"
  - "Updated Plan 02 comment referencing Plan 03 to remove stub references"

patterns-established:
  - "Pattern: OptionGroupForm/OptionForm sub-components declared before export default in same file — no separate files needed"
  - "Pattern: Mutation handlers pass onSuccess/onError callbacks; form catches via .catch and re-throws for inline error display"
  - "Pattern: isAbsolutePrice computed from parentGroupType drives both label and input constraints (no min on price_modifier)"

requirements-completed: [ORD-05, ORD-06, ORD-07]

duration: ~8min
completed: "2026-05-06"
---

# Phase 05 Plan 03: Inline Forms + Reorder Summary

**OptionGroupForm and OptionForm inline CRUD components fully wired into ProductDetailClient.tsx — admin can add, edit, and reorder option groups and options with optimistic UI updates and Supabase persistence.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-06T17:58:33Z
- **Completed:** 2026-05-06T18:06:00Z
- **Tasks:** 2 (implemented atomically in 1 commit)
- **Files modified:** 1

## Accomplishments

- `OptionGroupForm` sub-component with name, type (single/multiple/half_and_half), required toggle, min_selections, max_selections inputs — inline saving/error state
- `OptionForm` sub-component with adaptive price field per D-07: label and `min` constraint differ by group type, `base_price` vs `price_modifier` written correctly
- `handleSaveGroup` / `handleSaveOption` — full insert (with `price_rule: 'max'`, position) and update flows
- `moveGroup` / `moveOption` — optimistic position swap + `Promise.all` Supabase updates, `reorderInFlight` guard, silent state restore on error
- All 6 Plan 02 placeholder stubs replaced — `grep -c "Plan 03"` returns 0
- Build passes with zero TypeScript errors

## Task Commits

Both tasks modify the same file and were committed atomically:

1. **Tasks 1+2: OptionGroupForm, OptionForm, all mutation handlers, all placeholder replacements** - `683486f` (feat)

## Files Created/Modified

- `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx` — Added OptionGroupForm, OptionForm, handleSaveGroup, handleSaveOption, moveGroup, moveOption; replaced all Plan 02 placeholder stubs; removed unused `cn` import

## Decisions Made

- Tasks 1 and 2 were implemented atomically in one commit since both target the same file; creating an intermediate commit would have required uncommitting part of the file which is impractical.
- `_tenantId` (not `tenantId`) used in Supabase inserts to match the Props interface destructuring.
- The `cn` import was removed (it was only kept alive by `void cn` in Plan 02 as a suppressor) — no longer needed in Plan 03 since class logic uses direct string literals.
- The `void reorderInFlight` and `void setReorderInFlight` suppressors from Plan 02 were replaced by the actual usage in `moveGroup`/`moveOption`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `cn` import to prevent lint error**
- **Found during:** Tasks 1+2 (implementation)
- **Issue:** Plan 02 used `void cn` to suppress unused-import warning. In Plan 03, the void suppressors are replaced by actual logic. Without `void cn`, the import becomes unused and causes a TypeScript/ESLint error.
- **Fix:** Removed `cn` from the `import { formatPrice, cn }` statement — changed to `import { formatPrice }`.
- **Files modified:** `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx`
- **Verification:** Build exits 0 with no errors.
- **Committed in:** 683486f

**2. [Rule 1 - Bug] Updated Plan 02 comment referencing Plan 03**
- **Found during:** Final verification (`grep -c "Plan 03"` returned 1)
- **Issue:** A comment `// Expand state for inline forms (Plan 03 will use these)` remained from Plan 02, causing the `grep -c "Plan 03"` check to return 1 instead of 0.
- **Fix:** Updated comment to `// Expand state for inline forms`.
- **Files modified:** `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx`
- **Verification:** `grep -c "Plan 03"` returns 0.
- **Committed in:** 683486f

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered

None — implementation followed plan exactly; OptionGroupForm and OptionForm components slot cleanly into the placeholder positions established by Plan 02.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ORD-05, ORD-06, ORD-07 satisfied — admin can fully manage option groups and options
- ProductDetailClient.tsx is complete with zero placeholder stubs
- Public menu display (Phase 6) can now read and render product_option_groups + product_options
- Cart feature can reference option groups to build option selection UI for customers

## Self-Check

- [x] `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx` exists
- [x] Contains `function OptionGroupForm(`
- [x] Contains `function OptionForm(`
- [x] Contains `function handleSaveGroup(`
- [x] Contains `function handleSaveOption(`
- [x] Contains `function moveGroup(`
- [x] Contains `function moveOption(`
- [x] `grep -c "Plan 03" ProductDetailClient.tsx` returns 0
- [x] Contains `price_rule: 'max'` in insert payload
- [x] Contains `isAbsolutePrice` adaptive price logic
- [x] Contains `'Base price (full size price)'` string
- [x] Contains `'Price modifier (+/-)'` string
- [x] No `min="0"` on price_modifier input (uses spread conditional)
- [x] Commit 683486f exists in git history
- [x] `npm run build` exits 0

## Self-Check: PASSED

---
*Phase: 05-admin-product-options-ui*
*Completed: 2026-05-06*
