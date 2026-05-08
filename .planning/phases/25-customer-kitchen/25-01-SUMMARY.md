---
phase: 25-customer-kitchen
plan: "01"
subsystem: ui
tags: [next.js, react, supabase, tailwind, ingredients, customization, customer-facing, orders-api]

requires:
  - phase: 24-admin-catalog-02
    provides: product_ingredients associations, ingredientCustomizationEnabled flag in tenant_settings, ProductIngredientWithIngredient type
  - phase: 23-ingredient-schema
    provides: ingredients table, product_ingredients table, IngredientModifications JSONB type in database.ts, migration 026

provides:
  - productIngredientsByProductId fetch in both public server pages (gated on ingredientCustomizationEnabled)
  - ProductModal customization panel: stepper chips (−/0/+) for default ingredients + "Adicionar ingrediente" inline picker for non-default
  - Live price delta: finalUnitPrice = computedUnitPrice + ingredientDelta (extra/added charges, removal free)
  - ingredient_modifications JSONB through cart → submitOrder → API → DB insert (null when no modifications)
  - buildCartKey unchanged — same product+options = same cart slot regardless of modifications

affects: [26-kds-rendering, OrdersClient consumers, MenuPage consumers]

tech-stack:
  added: []
  patterns:
    - Mirror pattern: ingredient fetch in server pages mirrors existing optionGroupsByProductId block (conditional on flag + productIds)
    - Stepper state: ingredientSteppers Record<ingredient_id, -1|0|1> for default ingredients; addedIngredients string[] for non-default
    - IIFE price computation: ingredientDelta IIFE after computedUnitPrice IIFE — additive pattern
    - buildIngredientModifications helper inside ProductModal — returns null when all arrays empty (avoids falsy-truthy JSONB pitfall)
    - Pass-through typing: IngredientModifications imported at API route level for OrderItem interface correctness

key-files:
  created: []
  modified:
    - src/app/(public)/[slug]/[menuSlug]/page.tsx
    - src/app/(public)/[slug]/page.tsx
    - src/components/menu/MenuPage.tsx
    - src/app/api/orders/route.ts

key-decisions:
  - "productIngredientsByProductId fetch added to BOTH public server pages — parity and consistency even though [slug]/page.tsx passes no optionGroupsByProductId"
  - "buildCartKey left unchanged — modifications are slot metadata, not key dimensions (Pitfall 1 from RESEARCH)"
  - "buildIngredientModifications returns null when all arrays empty — avoids empty JSONB truthy check pitfall (Pitfall 2)"
  - "ingredientDelta IIFE placed after computedUnitPrice IIFE — additive; finalUnitPrice = computedUnitPrice + ingredientDelta"
  - "Tailwind literal classes used verbatim: text-red-600 line-through, text-amber-600, text-green-600, bg-green-50, bg-zinc-900 text-white, bg-zinc-100 text-zinc-600 (Pitfall 4)"
  - "Inline expandable picker (not a new modal) for Adicionar ingrediente — avoids z-index stacking in fixed modal (RESEARCH Q2)"

patterns-established:
  - "Server page ingredient fetch: conditional on ingredientCustomizationEnabled && productIds.length > 0 — mirrors directOrdersEnabled pattern"
  - "5-arg addToCart: (product, selectedOptions, unitPrice, note?, ingredientModifications?) — ingredient mods are optional trailing arg"
  - "ProductModal ingredient panel slot: below option groups, above item notes — consistent with item_notes v1.6 addition pattern"

requirements-completed: [INGR-07, INGR-08, INGR-09]

duration: 4min
completed: 2026-05-08
---

# Phase 25 Plan 01: Customer + Kitchen Summary

**Customer ingredient customization panel added to ProductModal with stepper chips + inline picker; live price delta computed; ingredient_modifications JSONB flows through cart to API to DB**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-08T16:10:19Z
- **Completed:** 2026-05-08T16:14:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Extended both public server pages (`[slug]/page.tsx` and `[slug]/[menuSlug]/page.tsx`) to fetch `product_ingredients` joined with `ingredients` when `ingredient_customization_enabled` is true; builds `productIngredientsByProductId` map and passes it with `ingredientCustomizationEnabled` flag to `MenuPage`
- Added two new optional props to `MenuPage` Props interface and destructure defaults; passes both to `ProductModal` for the selected product
- Extended `CartItem` interface with `ingredientModifications?: IngredientModifications | null`; extended `addToCart` with 5th arg; extended `submitOrder` items map with `ingredient_modifications` field
- Extended `ProductModal` with `ingredientCustomizationEnabled` and `productIngredients` props; added 3 state variables (`ingredientSteppers`, `addedIngredients`, `showAddIngredient`) reset on product change
- Implemented `ingredientDelta` IIFE and `finalUnitPrice = computedUnitPrice + ingredientDelta`; implemented `buildIngredientModifications()` helper returning null when no modifications
- Added customization panel UI: stepper chips (−/0/+) for `is_default=true` ingredients with strikethrough on removal and amber badge on extra; "Adicionar ingrediente" expandable inline picker for non-default ingredients; removable chips for added ingredients
- Updated "Add to cart" onClick to call `buildIngredientModifications()` and pass `mods` and `finalUnitPrice` to `onAddToCart`; updated price display to show `finalUnitPrice`
- Extended `orders/route.ts`: imported `IngredientModifications`, extended `OrderItem` interface, added `ingredient_modifications` to `orderItems` map

## Task Commits

Each task was committed atomically:

1. **Task 1: Server pages — fetch productIngredientsByProductId + pass to MenuPage** - `146e826` (feat)
2. **Task 2: MenuPage customization panel + orders API ingredient_modifications** - `dc6f54d` (feat)

## Files Created/Modified

- `src/app/(public)/[slug]/[menuSlug]/page.tsx` - Import ProductIngredientWithIngredient; add ingredientCustomizationEnabled + ingredient fetch block; pass 2 new props to MenuPage
- `src/app/(public)/[slug]/page.tsx` - Import ProductIngredientWithIngredient; add ingredientCustomizationEnabled + ingredient fetch block; pass 2 new props to MenuPage
- `src/components/menu/MenuPage.tsx` - Extended Props/CartItem/addToCart/submitOrder/ProductModal (signature + state + useEffect + price delta + helper + UI panel + onAddToCart call site)
- `src/app/api/orders/route.ts` - Import IngredientModifications; extend OrderItem interface; add ingredient_modifications to orderItems map

## Decisions Made

- Both public server pages fetch ingredients for parity — `[slug]/page.tsx` passes no `optionGroupsByProductId` but still fetches ingredients when flag is on
- `buildCartKey` unchanged — same product+options = same cart slot regardless of modifications (Pitfall 1)
- `buildIngredientModifications` returns null when all arrays empty (Pitfall 2 — avoids empty JSONB being truthy)
- Literal Tailwind classes used: `text-red-600 line-through`, `text-amber-600`, `text-green-600`, `bg-green-50` (Pitfall 4)
- Inline expandable picker, not a new modal, for "Adicionar ingrediente" (avoids z-index stacking in fixed overlay modal)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TypeScript compiled cleanly after both tasks (Task 1 alone had expected transient errors because MenuPage Props were not yet extended; resolved in Task 2).

## Known Stubs

None — all ingredient data flows from server-fetched props; panel only renders when `ingredientCustomizationEnabled && productIngredients.length > 0`.

## Next Phase Readiness

- Plan 01 complete: customer customization panel + cart + API pipeline fully wired (INGR-07, INGR-08, INGR-09)
- Phase 25 completes INGR-07/08/09; INGR-10 (KDS + admin orders rendering of ingredient_modifications) is out of scope for this plan and was not in the PLAN.md task list
- Ready for: KDS OrderCard + admin orders modal to render ingredient_modifications with color-coded prefixes (INGR-10)

---
*Phase: 25-customer-kitchen*
*Completed: 2026-05-08*
