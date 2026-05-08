---
phase: 24-admin-catalog
plan: "02"
subsystem: ui
tags: [next.js, supabase, react, tailwind, ingredients, feature-flag, admin, tabs]

requires:
  - phase: 24-admin-catalog-01
    provides: /admin/menu/ingredients CRUD page, ingredient_customization_enabled flag in tenant_settings, Ingredient + ProductIngredient types in database.ts
  - phase: 23-ingredient-schema
    provides: ingredients table, product_ingredients table, migration 026 with RLS policies

provides:
  - Product editor tab bar (Detalhes / Opcoes / Ingredientes) at /admin/menu/products/[id]
  - Ingredientes tab: searchable catalog picker + per-product ingredient association management
  - Per-association controls: is_default toggle, extra_price_override and add_price_override inputs with catalog-default placeholders
  - CRUD handlers: handleAddIngredient (insert), handleRemoveIngredient (delete), handleUpdateProductIngredient (update patch)
  - Ingredientes tab hidden entirely when ingredient_customization_enabled flag is false

affects: [25-customer-kitchen, ProductDetailClient consumers]

tech-stack:
  added: []
  patterns:
    - Tab bar pattern: activeTab state drives conditional rendering of content cards (details/options/ingredients)
    - defaultValue + onBlur pattern for per-row inputs — avoids React controlled/uncontrolled conflict on individual row updates
    - IIFE (immediately-invoked function expression) inside JSX for derived filtering logic (catalog filtered list)
    - Extra props with default values in Props interface — backward-compatible optional props

key-files:
  created: []
  modified:
    - src/app/(admin)/menu/products/[id]/page.tsx
    - src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx

key-decisions:
  - "Tab bar added between page header and content cards — Detalhes/Opcoes/Ingredientes; Ingredientes hidden when flag is false"
  - "defaultValue + onBlur on price override inputs — avoids controlled/uncontrolled React conflict when individual rows update independently"
  - "val !== '' ? parseFloat(val) : null — empty string always maps to null, falling back to catalog default_extra_price/default_add_price"
  - "ingredientCustomizationEnabled, allIngredients, initialProductIngredients are optional with defaults — fully backward-compatible"
  - "Ingredientes tab content split into two sections: Catalogo (unselected, filterable) + Ingredientes do produto (selected associations)"

patterns-established:
  - "Tab bar pattern: useState<'details'|'options'|'ingredients'> drives {activeTab === 'X' && <div>...}</div>} conditional card rendering"
  - "IIFE JSX filter: {(() => { const filtered = ...; return filtered.length > 0 ? <...> : null })()} for derived filtered lists in render"

requirements-completed: [INGR-06]

duration: 5min
completed: 2026-05-08
---

# Phase 24 Plan 02: Admin Catalog Summary

**Tab bar (Detalhes / Opcoes / Ingredientes) added to product editor; Ingredientes tab delivers searchable catalog picker + per-product ingredient associations with is_default toggle and per-product price override fields**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-08T14:49:52Z
- **Completed:** 2026-05-08T14:55:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `page.tsx` to fetch `ingredients` and `product_ingredients` in the existing `Promise.all` (now 5 queries), added `ingredient_customization_enabled` to the `tenant_settings` select, and passes three new typed props to `ProductDetailClient`
- Added tab bar (Detalhes / Opcoes / Ingredientes) to `ProductDetailClient` — `activeTab` state controls which content card is rendered; Ingredientes tab only appears when `ingredient_customization_enabled` is true
- Ingredientes tab: searchable catalog picker shows unselected ingredients with "Adicionar" button; selected ingredients show in "Ingredientes do produto" section with is_default toggle and two price override inputs
- Price override inputs use `defaultValue` + `onBlur` to persist on blur, storing `null` when the field is empty (falls back to catalog default); placeholder shows `Padrão: R$X.XX`
- Three CRUD handlers: `handleAddIngredient` (insert row), `handleRemoveIngredient` (delete row), `handleUpdateProductIngredient` (update patch) — all update local state immediately on success

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend page.tsx — fetch ingredients + product_ingredients + flag** - `52e5498` (feat)
2. **Task 2: Extend ProductDetailClient.tsx — tab bar + Ingredientes tab** - `831f8fb` (feat)

## Files Created/Modified

- `src/app/(admin)/menu/products/[id]/page.tsx` - Extended Promise.all to 5 queries; added Ingredient/ProductIngredient imports; passes ingredientCustomizationEnabled, allIngredients, initialProductIngredients to ProductDetailClient
- `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx` - Extended Props interface; added activeTab/productIngredients/ingredientSearch/ingLoading state; tab bar JSX; wrapped existing cards in tab conditionals; full Ingredientes tab with picker + associations + CRUD handlers

## Decisions Made

- Tab bar pattern with `useState<'details' | 'options' | 'ingredients'>` — clean conditional card rendering, zero complexity
- `defaultValue` + `onBlur` on price override inputs — avoids React controlled/uncontrolled conflict when individual row state patches independently
- Empty string always maps to null (`val !== '' ? parseFloat(val) : null`) — explicit contract for catalog default fallback
- All new props optional with defaults (`ingredientCustomizationEnabled = false`, `allIngredients = []`, `initialProductIngredients = []`) — fully backward-compatible

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TypeScript compiled cleanly after Task 2 (Task 1 alone had an expected transient error because ProductDetailClient Props had not been extended yet).

## Known Stubs

None — all ingredient data flows from server-fetched props; no placeholder or hardcoded mock data.

## Next Phase Readiness

- Plan 02 complete: admins can assign catalog ingredients to products with per-product price overrides
- Phase 24 complete: full admin ingredient workflow (catalog CRUD in Plan 01 + product assignment in Plan 02)
- Ready for Phase 25: customer ingredient customization panel in ProductModal + KDS rendering of ingredient_modifications

---
*Phase: 24-admin-catalog*
*Completed: 2026-05-08*
