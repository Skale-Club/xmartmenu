---
phase: 29
plan: "01"
subsystem: menu
tags: [refactor, decomposition, dynamic-import, typescript]
dependency_graph:
  requires: []
  provides: [menu-utils.ts, ProductModal.tsx, CartModal.tsx]
  affects: [MenuPage.tsx]
tech_stack:
  added: []
  patterns: [next/dynamic lazy loading, named exports from utils module, UICopyEntry explicit type alias]
key_files:
  created:
    - src/components/menu/menu-utils.ts
    - src/components/menu/ProductModal.tsx
    - src/components/menu/CartModal.tsx
  modified:
    - src/components/menu/MenuPage.tsx
decisions:
  - UICopyEntry explicit type alias defined in menu-utils.ts — avoids typeof UI_COPY[string] in CartModal props
  - next/dynamic with ssr:false for both modals — modals are client-only overlays, no SSR benefit
  - CartItem and buildCartKey co-located in menu-utils.ts with UI_COPY — single import for MenuPage and CartModal
  - TAG_TRANSLATIONS, TAG_COLORS, translateTag, getTagStyle, ProductCard remain in MenuPage.tsx — not shared across files
  - ProductModal duplicates TAG_ helpers — acceptable since ProductCard stays in MenuPage and shares those helpers
metrics:
  duration: "~5 min (329s)"
  completed: "2026-05-08"
  tasks: 4
  files: 4
---

# Phase 29 Plan 01: MenuPage Decomposition Summary

**One-liner:** Split 1522-line MenuPage.tsx into menu-utils.ts (shared data), ProductModal.tsx (product detail overlay), and CartModal.tsx (order cart overlay) via next/dynamic lazy imports.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create menu-utils.ts | 1b63e13 |
| 2 | Extract ProductModal.tsx | e0a704a |
| 3 | Extract CartModal.tsx | d25d0bb |
| 4 | Update MenuPage.tsx with dynamic imports | f4f5da6 |

## What Was Built

### menu-utils.ts (40 lines)
Exports: `getProductImages`, `UI_COPY`, `UICopyEntry` (explicit type alias), `CartItem` (interface), `buildCartKey`.

### ProductModal.tsx (647 lines)
Full `'use client'` component with image carousel (touch swipe), option group selectors (single/multiple/half-and-half), ingredient customization panel, per-item notes, and cart integration. Imports `UI_COPY` and `getProductImages` from `./menu-utils`.

### CartModal.tsx (172 lines)
Full `'use client'` component for cart management and order submission. `ui` prop typed as `UICopyEntry` (not `typeof UI_COPY[string]`). Imports `CartItem` and `UICopyEntry` from `./menu-utils`.

### MenuPage.tsx (726 lines, was 1522)
Added `import dynamic from 'next/dynamic'`, dynamic imports for both modals with `ssr: false`, imports from `./menu-utils`. Removed all extracted definitions. JSX call sites for `ProductModal` and `CartModal` unchanged.

## Verification

- `npx tsc --noEmit` exits 0 — no TypeScript errors
- All 4 files created/updated with correct exports and imports
- MenuPage.tsx reduced from 1522 to 726 lines (-52%)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Re-added GroupWithOptions and ProductIngredientWithIngredient imports to MenuPage.tsx**
- **Found during:** Task 4 (after editing the import line)
- **Issue:** The Props interface in MenuPage.tsx references `GroupWithOptions` (line 27) and `ProductIngredientWithIngredient` (line 29) — these were removed from imports when cleaning up
- **Fix:** Added both types back to MenuPage.tsx imports (`@/types/database` and `@/app/(admin)/menu/products/[id]/page`)
- **Files modified:** `src/components/menu/MenuPage.tsx`
- **Commit:** f4f5da6 (included in task 4 commit)

**2. [Rule 2 - Missing explicit type alias] Defined UICopyEntry in menu-utils.ts**
- **Found during:** Task 3 (CartModal creation)
- **Issue:** `ui: typeof UI_COPY[string]` in CartModal props requires UI_COPY to be in scope; with extraction to a separate file, an explicit type alias is cleaner and TypeScript-safe
- **Fix:** Defined `export type UICopyEntry` in menu-utils.ts; CartModal imports and uses it directly
- **Files modified:** `src/components/menu/menu-utils.ts`, `src/components/menu/CartModal.tsx`
- **Commit:** 1b63e13, d25d0bb

## Known Stubs

None — all functionality is fully wired. Dynamic imports resolve to the extracted components at runtime.

## Self-Check: PASSED

All created files verified present:
- FOUND: src/components/menu/menu-utils.ts
- FOUND: src/components/menu/ProductModal.tsx
- FOUND: src/components/menu/CartModal.tsx
- FOUND: src/components/menu/MenuPage.tsx

All commits verified in git log:
- FOUND: 1b63e13
- FOUND: e0a704a
- FOUND: d25d0bb
- FOUND: f4f5da6
