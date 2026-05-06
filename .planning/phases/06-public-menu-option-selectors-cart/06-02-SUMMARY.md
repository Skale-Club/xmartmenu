---
phase: 06-public-menu-option-selectors-cart
plan: 02
subsystem: public-menu
tags: [cart, option-groups, cartKey, unitPrice]
dependency_graph:
  requires: [06-01]
  provides: [06-03]
  affects: [src/components/menu/MenuPage.tsx]
tech_stack:
  added: []
  patterns: [composite-cart-key, sorted-key-serialization]
key_files:
  created: []
  modified:
    - src/components/menu/MenuPage.tsx
decisions:
  - "CartItem extended with selectedOptions, unitPrice, cartKey (D-05)"
  - "buildCartKey sorts entries alphabetically before JSON.stringify to ensure stable composite keys (Pitfall 7)"
  - "addToCart signature changed to (product, selectedOptions, unitPrice) — call site uses placeholder ({}, product.price) until Plan 03 wires real option selection"
  - "CartModal prop types updated to accept itemCartKey instead of productId"
metrics:
  duration: 326s
  completed: "2026-05-06"
  tasks_completed: 2
  files_modified: 1
---

# Phase 6 Plan 2: CartItem Extension + CartModal Update Summary

Extended CartItem interface with composite cart key support. Same product with different options now occupies separate cart slots. CartModal totals and per-item subtotals use resolved unitPrice. Options summary line renders per item when selectedOptions is non-empty.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend MenuPage Props + CartItem interface + add cartKey helper | 598f2bd | src/components/menu/MenuPage.tsx |
| 2 | Update CartModal — cartKey props, unitPrice totals, options summary | 8a23c13 | src/components/menu/MenuPage.tsx |

## Decisions Made

1. `buildCartKey` sorts `selectedOptions` entries alphabetically before `JSON.stringify` — guarantees stable keys regardless of property insertion order (Pitfall 7 from research).
2. `addToCart` call site in the existing ProductModal JSX updated to placeholder `addToCart(selectedProduct, {}, selectedProduct.price)` — Plan 03 will replace with real option-aware callback after OptionSelector is wired.
3. CartModal `onRemove`/`onUpdateQuantity` prop types changed from `productId: string` to `itemCartKey: string` — consistent with the new cartKey-keyed cart state.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `grep -n "item.product.price" src/components/menu/MenuPage.tsx` returns 0 results (confirmed)
- `grep -n "cartKey" src/components/menu/MenuPage.tsx | wc -l` returns 10 (>= 8 required)
- `grep -n "optionGroupsByProductId" src/components/menu/MenuPage.tsx` returns 2 lines (confirmed)
- `npm run build` exits 0 (confirmed)

## Self-Check: PASSED

- src/components/menu/MenuPage.tsx: FOUND (modified)
- Commit 598f2bd: FOUND
- Commit 8a23c13: FOUND
