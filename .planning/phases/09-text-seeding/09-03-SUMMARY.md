---
phase: 09-text-seeding
plan: 03
subsystem: ui
tags: [react, nextjs, tailwind, ai-tools, superadmin]

# Dependency graph
requires:
  - phase: 09-01
    provides: AI infra (sanitizeForPrompt, ai_usage table, migration 022 with business_type column)
  - phase: 09-02
    provides: Seed API route handling all 6 seed types (menu/categories/products/copy/single_category/single_product)
provides:
  - AI Tools UI section on superadmin tenant detail page with bulk and per-item seed buttons
  - business_type fetched from tenant_settings and passed as prop to TenantDetailClient
  - supported_languages fetched from menus for future per-menu language context
  - /api/superadmin/tenants/[id]/menus/[menuId]/categories-list GET endpoint
affects: [phase-10-image-seeding, phase-11-ocr]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useEffect for async data fetch keyed on state (selectedMenuId drives menuCategories fetch)
    - Single seedLoading flag disables all bulk buttons to prevent concurrent calls
    - perItemLoading string key distinguishes which per-item button is active

key-files:
  created:
    - src/app/api/superadmin/tenants/[id]/menus/[menuId]/categories-list/route.ts
  modified:
    - src/app/(superadmin)/tenants/[id]/page.tsx
    - src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx

key-decisions:
  - "categories-list endpoint created at /api/superadmin/tenants/[id]/menus/[menuId]/categories-list — no existing superadmin route covered per-menu category listing"
  - "AI Tools section placed outside tab system, always visible below Tabs block per UI-SPEC Layout Specification"
  - "perItemLoading uses string key ('cat' for single_category, categoryId string for single_product) to distinguish per-item button state"

patterns-established:
  - "Per-item seed: category selector uses useEffect fetch on selectedMenuId change, resets selectedCategoryId on menu switch"
  - "Bulk seed: single seedLoading boolean gates all 4 buttons; success/error state cleared on next seed call"

requirements-completed: [AI-06]

# Metrics
duration: 20min
completed: 2026-05-06
---

# Phase 9 Plan 03: AI Tools UI Summary

**AI Tools section added to superadmin tenant detail page — bulk seed buttons (Seed menu/categories/products/copy) plus per-item Seed category and Seed product with live category selector, all wired to the seed API from Plan 02**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-06T22:15:00Z
- **Completed:** 2026-05-06T22:35:00Z
- **Tasks:** 2
- **Files modified:** 3 (+ 1 new file created)

## Accomplishments

- Extended `page.tsx` to fetch `business_type` from `tenant_settings` and `supported_languages` from `menus`, passing `businessType` as a new prop to `TenantDetailClient`
- Added full AI Tools section to `TenantDetailClient.tsx` below the Tabs block: 4 bulk seed buttons (primary + 3 secondary styled per UI-SPEC), business type context display, menu selector for multi-menu tenants, loading/success/error state machines
- Added per-item seeding subsection with "Seed category" button and "Seed product" button backed by a live category selector (populated via useEffect fetch to new categories-list API endpoint)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend page.tsx to fetch and pass business_type prop** - `6d7c669` (feat)
2. **Task 2: Add AI Tools section to TenantDetailClient** - `410cf35` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `src/app/(superadmin)/tenants/[id]/page.tsx` — Added `business_type` to tenant_settings select, `supported_languages` to menus select, `businessType` prop passed to TenantDetailClient
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — Added businessType prop, Menu.supported_languages field, 9 AI Tools state variables, useEffect for category fetch, buildSuccessMessage/handleSeed/handleSeedSingle helpers, full AI Tools JSX section
- `src/app/api/superadmin/tenants/[id]/menus/[menuId]/categories-list/route.ts` — New GET endpoint returning `{ categories: [{id, name}] }` for the selected menu, used by the per-item Seed product category selector

## Decisions Made

- Created `/api/superadmin/tenants/[id]/menus/[menuId]/categories-list` as a new dedicated endpoint because no existing superadmin route provided per-menu category listing. The existing admin categories route uses tenant session context and cannot be called by superadmin.
- AI Tools section placed outside the tab system (per UI-SPEC Layout Specification) — always visible below the Tabs block, not inside Staff or Menus tab content.
- `perItemLoading` uses a string key (`'cat'` for single_category, `categoryId` string for single_product) allowing each per-item button to independently show "Seeding..." without affecting others.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added categories-list API endpoint**
- **Found during:** Task 2 (Add AI Tools section to TenantDetailClient)
- **Issue:** Plan's NOTE in JSX instructed executor to fetch `/api/superadmin/tenants/${tenant.id}/menus/${selectedMenuId}/categories-list` but this endpoint did not exist. The per-item Seed product button's category selector would silently return no categories.
- **Fix:** Created `src/app/api/superadmin/tenants/[id]/menus/[menuId]/categories-list/route.ts` — a simple superadmin-guarded GET that selects `id, name` from categories filtered by `tenant_id` and `menu_id`, ordered by position, returns `{ categories: [...] }`.
- **Files modified:** `src/app/api/superadmin/tenants/[id]/menus/[menuId]/categories-list/route.ts` (created)
- **Verification:** TypeScript compiles cleanly; endpoint follows same pattern as existing superadmin menus route
- **Committed in:** `410cf35` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — missing endpoint)
**Impact on plan:** The categories-list endpoint is directly required for the per-item Seed product button to function. Without it, the category selector would always be empty and Seed product would be permanently disabled. No scope creep.

## Issues Encountered

None — plan executed cleanly after the categories-list endpoint was added.

## User Setup Required

None — no external service configuration required. The seed API already requires `GOOGLE_GENERATIVE_AI_API_KEY` (configured in Phase 09-01).

## Next Phase Readiness

- Phase 9 (text-seeding) is fully complete: AI infra (09-01), seed API (09-02), and UI (09-03) are all shipped
- Superadmin can now seed menu content for any tenant from the tenant detail page
- Phase 10 (image-seeding) can proceed — it depends on Phase 9 product IDs which are now seeded via this UI
- Phase 11 (OCR) can proceed — it depends on Phase 9 infra (sanitizeForPrompt, ai_usage) which were established in 09-01

---
*Phase: 09-text-seeding*
*Completed: 2026-05-06*
