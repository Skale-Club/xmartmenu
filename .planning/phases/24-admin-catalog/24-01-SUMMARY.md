---
phase: 24-admin-catalog
plan: "01"
subsystem: ui
tags: [next.js, supabase, react, tailwind, ingredients, feature-flag, admin]

requires:
  - phase: 23-ingredient-schema
    provides: Ingredient and ProductIngredient types in database.ts, ingredients table with RLS, ingredient_customization_enabled flag in tenant_settings (migration 026)

provides:
  - /admin/menu/ingredients page — full CRUD (create/edit/delete modal) + up/down reorder, gated by ingredient_customization_enabled
  - IngredientsClient — client component with optimistic reorder using ChevronUp/ChevronDown
  - AdminSidebar — now accepts ingredientCustomizationEnabled prop to conditionally show Ingredientes nav item
  - Admin layout — now queries ingredient_customization_enabled and passes to AdminSidebar in both superadmin-preview and regular tenant paths

affects: [25-customer-kitchen, AdminSidebar consumers, admin layout consumers]

tech-stack:
  added: []
  patterns:
    - Server Component page fetches data + passes props to Client Component (established pattern, applied to ingredients)
    - Supabase direct client CRUD from client components (no API routes)
    - Optimistic reorder with Promise.all swap + silent rollback on error
    - Feature flag prop threading: layout.tsx -> AdminSidebar -> conditionally render nav item

key-files:
  created:
    - src/app/(admin)/menu/ingredients/page.tsx
    - src/app/(admin)/menu/ingredients/IngredientsClient.tsx
  modified:
    - src/app/(admin)/layout.tsx
    - src/components/admin/AdminSidebar.tsx

key-decisions:
  - "ingredientCustomizationEnabled prop added to AdminSidebar with default false — backward compatible with all existing callers"
  - "visibleMainItems built dynamically: [...mainItems, ...(ingredientCustomizationEnabled ? [ingredienteItem] : [])].filter(staff filter) — clean conditional append"
  - "Both superadmin-preview and regular tenant paths in layout.tsx get the same settings query — consistent behavior for superadmins previewing tenants"
  - "No @dnd-kit — up/down arrow buttons (ChevronUp/ChevronDown) consistent with existing ProductDetailClient reorder pattern"

patterns-established:
  - "Feature flag gating: server page redirects when flag is off; sidebar item is conditionally hidden via prop"
  - "Position on insert: ingredients.length ensures new items get unique position without gaps"

requirements-completed: [INGR-05]

duration: 7min
completed: 2026-05-08
---

# Phase 24 Plan 01: Admin Catalog Summary

**Ingredients catalog page at /admin/menu/ingredients with full CRUD modal + ChevronUp/Down reorder, gated by ingredient_customization_enabled; Ingredientes nav item in AdminSidebar conditionally shown via prop from layout.tsx**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-08T14:40:00Z
- **Completed:** 2026-05-08T14:47:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `/admin/menu/ingredients` ingredients catalog page — server component redirects to /admin/dashboard when flag is off; client component renders full list with CRUD modal and optimistic up/down reorder
- Extended AdminSidebar to accept `ingredientCustomizationEnabled` prop and conditionally append the Ingredientes nav item
- Extended admin layout.tsx to query `ingredient_customization_enabled` from `tenant_settings` in both the superadmin-preview path and the regular tenant path, passing the result to AdminSidebar

## Task Commits

Each task was committed atomically:

1. **Task 1: Ingredients page (server) + IngredientsClient (client CRUD + reorder)** - `0c221c9` (feat)
2. **Task 2: Extend layout.tsx (flag query) and AdminSidebar.tsx (Ingredientes nav item)** - `60d4428` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/app/(admin)/menu/ingredients/page.tsx` - Server component: fetches ingredients + flag, redirects when disabled, passes props to IngredientsClient
- `src/app/(admin)/menu/ingredients/IngredientsClient.tsx` - Client component: list, modal CRUD, reorder via ChevronUp/Down with optimistic state and Promise.all swap
- `src/app/(admin)/layout.tsx` - Extended Promise.all in both paths to query ingredient_customization_enabled; passes prop to AdminSidebar
- `src/components/admin/AdminSidebar.tsx` - Added ingredientCustomizationEnabled prop; conditionally appends Ingredientes nav item using dynamic visibleMainItems construction

## Decisions Made
- ingredientCustomizationEnabled defaults to false in AdminSidebar — fully backward-compatible, no breaking change for callers that don't pass the prop
- No @dnd-kit — up/down arrow buttons replicate the exact ProductDetailClient.tsx moveGroup pattern, consistent with project conventions
- Modal pattern (not inline edit) for ingredient CRUD — ingredient form has 4 fields + toggle, manageable in a modal; matches ProductsClient pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Feature is gated by `ingredient_customization_enabled` which must be set to true in the tenant's `tenant_settings` row to enable the page and sidebar item.

## Next Phase Readiness
- Plan 01 complete: ingredient catalog CRUD page is live for tenants with the feature flag enabled
- Ready for Plan 02: product editor Ingredientes tab — will add ingredient assignment (product_ingredients table) to existing product detail page

---
*Phase: 24-admin-catalog*
*Completed: 2026-05-08*
