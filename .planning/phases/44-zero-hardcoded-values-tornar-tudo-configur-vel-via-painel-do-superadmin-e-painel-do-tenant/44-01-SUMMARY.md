---
phase: 44-zero-hardcoded-values
plan: "01"
subsystem: database, api, ui
tags: [platform_settings, migration, footerBrand, seo_title, seo_description, cta_color]

# Dependency graph
requires:
  - phase: 004_platform_settings
    provides: platform_settings table with RLS and singleton constraint

provides:
  - Migration 045 adding cta_color, seo_title, seo_description to platform_settings
  - PATCH API allowing seo_title and seo_description saves
  - Public menu pages fetching menu_footer_brand from DB and passing to MenuPage

affects: [phase-44-02, phase-44-03, superadmin-settings, public-menu-pages]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - platform_settings fetch pattern with single() and ?? fallback for safe defaults

key-files:
  created:
    - supabase/migrations/045_platform_settings_columns.sql
  modified:
    - src/app/api/superadmin/settings/route.ts
    - src/app/(public)/[slug]/page.tsx
    - src/app/(public)/[slug]/[menuSlug]/page.tsx

key-decisions:
  - "Migration 045 uses IF NOT EXISTS guards on all 3 columns for idempotency (consistent with migrations 027, 028, 034)"
  - "footerBrand fetched independently in each public page — no shared util needed for a single .single() call"
  - "Fallback 'XmartMenu' kept in both pages so pages remain safe if DB row is missing"

patterns-established:
  - "platform_settings fetch: await supabase.from('platform_settings').select('col').single() with ?? fallback"

requirements-completed:
  - CFG-01
  - CFG-05

# Metrics
duration: 2min
completed: 2026-05-20
---

# Phase 44 Plan 01: Zero Hardcoded Values (DB migration + footerBrand wiring) Summary

**Migration 045 adds cta_color/seo_title/seo_description to platform_settings; both public menu pages now serve footer brand from DB instead of hardcoded 'XmartMenu'**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-20T03:53:59Z
- **Completed:** 2026-05-20T03:56:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created migration 045 adding `cta_color` (NOT NULL DEFAULT '#EEFF00'), `seo_title`, and `seo_description` to `platform_settings` with IF NOT EXISTS guards
- Updated PATCH allowed list in `settings/route.ts` to accept `seo_title` and `seo_description` (previously silently discarded)
- Both public menu pages (`[slug]/page.tsx` and `[slug]/[menuSlug]/page.tsx`) now query `platform_settings.menu_footer_brand` and pass the value as `footerBrand` prop to `MenuPage`

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 045** - `fde9182` (feat)
2. **Task 2: PATCH allowed list + footerBrand wiring** - `6885de9` (feat)

## Files Created/Modified

- `supabase/migrations/045_platform_settings_columns.sql` — ALTER TABLE adding cta_color, seo_title, seo_description with IF NOT EXISTS
- `src/app/api/superadmin/settings/route.ts` — seo_title and seo_description added to PATCH allowed list
- `src/app/(public)/[slug]/page.tsx` — fetches menu_footer_brand, passes footerBrand={footerBrand} to MenuPage
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — same as above for branch/menu-slug route

## Decisions Made

- Migration 045 uses IF NOT EXISTS on all 3 ALTER COLUMN statements — consistent with project migration idempotency pattern (migrations 027, 028, 034)
- footerBrand fallback remains `'XmartMenu'` in code — safe if DB row doesn't exist yet before migration is applied

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Apply migration 045 via Supabase SQL Editor (same pattern as migrations 027, 028, 034):

```sql
-- Copy contents of supabase/migrations/045_platform_settings_columns.sql
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS cta_color       TEXT NOT NULL DEFAULT '#EEFF00',
  ADD COLUMN IF NOT EXISTS seo_title       TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT;
```

## Next Phase Readiness

- Wave 1 parallel: plan 44-02 (landing CMS data wiring) can execute in parallel with this plan
- Wave 2: plan 44-03 (generateMetadata + superadmin app_name) depends on both wave-1 plans completing

---
*Phase: 44-zero-hardcoded-values*
*Completed: 2026-05-20*
