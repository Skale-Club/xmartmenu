---
phase: 10-image-seeding
plan: "02"
subsystem: ui
tags: [react, next.js, tailwind, image-seeding, gemini, supabase-storage]

# Dependency graph
requires:
  - phase: 10-image-seeding-01
    provides: "POST /api/superadmin/tenants/[id]/seed-image — image_cover, image_products, image_single_product"
  - phase: 09-text-seeding
    provides: "TenantDetailClient AI Tools section, selectedCategoryId state, menuCategories state, seedLoading state"
provides:
  - "Image seeding UI — Seed cover, Seed product images, and single-product Seed image controls inside AI Tools section of TenantDetailClient"
affects: [phase-11-ocr, superadmin-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "imageSeedLoading typed as string | null — stores active seed type for per-button loading states"
    - "Product selector reuses existing selectedCategoryId to cascade category → product selection without new API routes"
    - "Image seed buttons disabled via both imageSeedLoading and seedLoading — cross-feature mutual exclusion"

key-files:
  created: []
  modified:
    - src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx

key-decisions:
  - "Reuse selectedCategoryId for product selector cascade — avoids adding a /products-list API route in this plan"
  - "imageSeedLoading typed as string | null (not boolean) — enables per-button loading text differentiation"
  - "Image seed buttons disabled while seedLoading is true and vice versa — prevents concurrent text+image seeding"

patterns-established:
  - "Pattern: per-operation loading string for button label differentiation — imageSeedLoading === 'image_cover' guards specific button text"
  - "Pattern: image seed UI appended inside AI Tools section without new tabs — D-08/D-09 constraint honored"

requirements-completed: [AI-07, AI-08, AI-09]

# Metrics
duration: ~5min
completed: 2026-05-07
---

# Phase 10 Plan 02: Image Seed UI Summary

**TenantDetailClient extended with Seed cover, Seed product images, and single-product Seed image controls inside the existing AI Tools section — calling the seed-image route with per-button loading states, slow-operation warnings, and success/error banners.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-07T10:00:00Z
- **Completed:** 2026-05-07T10:05:00Z
- **Tasks:** 1 (+ 1 checkpoint: human-verify, approved)
- **Files modified:** 1

## Accomplishments

- Added four new state variables to TenantDetailClient: `imageSeedLoading`, `imageSeedStatus`, `selectedProductId`, `menuProducts`
- Added a useEffect that populates `menuProducts` from the categories-list endpoint whenever `selectedCategoryId` changes — feeds the single-product image selector without a new API route
- Added `handleSeedImage()` handler that POSTs to `/api/superadmin/tenants/${tenant.id}/seed-image` with the correct body shape for each of the three image seed types (`image_cover`, `image_products`, `image_single_product`)
- Added Image Seeding sub-section to the AI Tools card: "Seed cover" button, "Seed product images" button, slow-operation pulse warnings for each, and a category-scoped product selector + "Seed image" button
- Added success and error banners using the same shape as the existing `seedStatus` banners
- All image seed buttons disabled while `seedLoading` (text seeding) is active; all text seed buttons remain protected via their existing disabled conditions

## Task Commits

1. **Task 1: Add image seeding state, handlers, and product selector fetch to TenantDetailClient** - `f4236ad` (feat)

**Plan metadata:** (see final docs commit)

## Files Created/Modified

- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — image seeding state, useEffect for product list, handleSeedImage handler, and Image Seeding JSX sub-section appended to AI Tools card

## Decisions Made

1. **Reuse selectedCategoryId for product selector** — The existing category selector in the per-item text seeding block already controls `selectedCategoryId`. The new product useEffect watches that same state variable, so selecting a category in the text seeding block also populates the product dropdown for image seeding. This avoids creating a separate `/products-list` route in this plan.
2. **imageSeedLoading typed as `string | null`** — Storing the active seed type (not just a boolean) allows each button to show its own loading text (e.g., "Generating cover..." vs "Seeding images...") while sharing one state variable.
3. **Cross-feature mutual exclusion** — Image seed buttons are disabled while `seedLoading` is true and vice versa (`|| !!imageSeedLoading` on text seed buttons). Prevents simultaneous text+image seeding calls to the same tenant.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required beyond what Plan 10-01 already established (GOOGLE_GENERATIVE_AI_API_KEY).

## Known Stubs

None — the Image Seeding UI wires directly to the seed-image route from Plan 10-01. Product selector populates from the categories-list endpoint that was created in Phase 9. No placeholder values or mock data.

## Next Phase Readiness

- Phase 10 (Image Seeding) is complete — both backend (Plan 01) and UI (Plan 02) are in place
- Superadmin can now seed cover banner and per-product images for any tenant from the AI Tools section
- Phase 11 (Menu Photo OCR) can begin — depends on Phase 9 infrastructure only; no Phase 10 outputs are required

## Self-Check

- [x] `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` modified — FOUND (commit f4236ad)
- [x] Commit `f4236ad` (Task 1) — FOUND in git log
- [x] No new files created — confirmed (UI changes only, no new routes)
- [x] Requirements AI-07, AI-08, AI-09 addressed — confirmed via plan frontmatter and task acceptance criteria

## Self-Check: PASSED

---
*Phase: 10-image-seeding*
*Completed: 2026-05-07*
