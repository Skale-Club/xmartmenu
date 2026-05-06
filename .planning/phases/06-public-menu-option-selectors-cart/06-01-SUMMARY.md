---
phase: 06-public-menu-option-selectors-cart
plan: "01"
subsystem: api
tags: [supabase, next.js, ssr, option-groups, product-options, isr]

# Dependency graph
requires:
  - phase: 05-product-option-groups-admin
    provides: product_option_groups + product_options tables with RLS; GroupWithOptions type exported from admin page
provides:
  - Server component fetch of product option groups grouped by product_id
  - optionGroupsByProductId prop wired to MenuPage
affects:
  - 06-02 (MenuPage CartItem/addToCart refactor consumes this prop)
  - 06-03 (ProductModal option selector UI consumes this prop)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stage 3 sequential fetch after Stage 2 products resolve (product_ids required before option groups query)"
    - "directOrdersEnabled gate pattern: skip optional DB queries when feature flag disabled"
    - "Server-side is_available filter on nested product_options before passing to client"
    - "Reduce into Record<string, GroupWithOptions[]> keyed by product_id on server"

key-files:
  created: []
  modified:
    - src/app/(public)/[slug]/[menuSlug]/page.tsx

key-decisions:
  - "Stage 3 runs sequentially after Stage 2 (not in same Promise.all) because product IDs are required to filter option groups"
  - "Gate behind directOrdersEnabled to avoid unnecessary DB round-trip for tenants without direct orders"
  - "Filter is_available=false options server-side in grouping loop, not via inner join (inner join would exclude groups with no available options)"

patterns-established:
  - "Feature-flag-gated Stage N fetch: check tenant_settings before issuing optional DB query"
  - "Server-side reduce into Record<id, T[]> for per-product client lookup without runtime fetch"

requirements-completed: [ORD-08]

# Metrics
duration: 8min
completed: "2026-05-06"
---

# Phase 06-01: Public Menu Option Groups Server Fetch Summary

**Server component fetches product_option_groups with nested options, gated behind directOrdersEnabled, grouped by product_id, and passes optionGroupsByProductId prop to MenuPage**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-06T15:24:00Z
- **Completed:** 2026-05-06T15:32:10Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added Stage 3 option groups fetch to the public menu server component, running after Stage 2 resolves product IDs
- Gated the DB query behind `directOrdersEnabled` flag to avoid unnecessary round-trips
- Filtered `is_available=false` options server-side in the grouping loop
- Wired `optionGroupsByProductId: Record<string, GroupWithOptions[]>` prop to `MenuPage`
- Build passes with no TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add option groups fetch (Stage 3) + pass prop to MenuPage** - `d733ca2` (feat)

## Files Created/Modified

- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — Added GroupWithOptions import, Stage 3 fetch (gated + grouped + filtered), optionGroupsByProductId prop on MenuPage

## Decisions Made

- Stage 3 runs sequentially after Stage 2 (not parallel) because `productIds` must resolve from the products query before the `.in('product_id', productIds)` filter can be applied
- Used the `directOrdersEnabled` gate: `tenant.tenant_settings?.direct_orders_enabled ?? false` — if false or productIds empty, `optionGroupsByProductId` stays `{}` with zero DB queries
- is_available filter applied in the grouping loop (not via inner join) so groups with zero available options are preserved as empty arrays rather than being dropped entirely

## Deviations from Plan

None - plan executed exactly as written.

(Note: MenuPage.tsx already had `optionGroupsByProductId?: Record<string, GroupWithOptions[]>` in its Props interface and the GroupWithOptions import before this plan ran — no deviation was needed.)

## Issues Encountered

- Build lock file (`/.next/lock`) was stale from a previous build process; removed it before running `npm run build`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `page.tsx` now passes `optionGroupsByProductId` to `MenuPage` — Plan 02 can extend `CartItem` and update `addToCart`/`cartTotal` without any server component changes
- Plan 02 (CartItem + addToCart refactor) and Plan 03 (ProductModal option selector UI) can proceed immediately

---
*Phase: 06-public-menu-option-selectors-cart*
*Completed: 2026-05-06*
