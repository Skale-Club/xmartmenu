---
phase: 49-db-seeds-color-branding
plan: "01"
subsystem: db
tags: [migration, platform_settings, color, seeds]

requires:
  - phase: 46-global-color-rebrand
    provides: #F52323 is now the codebase default

provides:
  - cta_color column default changed to #F52323
  - Existing platform_settings row cta_color updated if still yellow

affects: [platform_settings, new-tenant-onboarding]

key-files:
  created:
    - supabase/migrations/046_rebrand_color_defaults.sql
  modified: []

requirements-completed:
  - SEED-01
  - SEED-02

duration: ~5min
completed: 2026-05-25
---

# Phase 49 Plan 01: DB Seeds — Color & Branding Defaults

**Migration 046 updates the cta_color column default and existing row to #F52323.**

## Accomplishments

- `supabase/migrations/046_rebrand_color_defaults.sql` created:
  - `ALTER TABLE platform_settings ALTER COLUMN cta_color SET DEFAULT '#F52323'`
  - `UPDATE platform_settings SET cta_color = '#F52323' WHERE cta_color IN ('#EEFF00','#CBFF00')`
- No `#EEFF00` or `#CBFF00` remain in any seed or migration (045 has the old default as historical record, 046 overrides it)

## Decisions Made

- Did NOT update `landing.features.items[3].icon` via migration — the live DB may have a different features array structure than assumed (old 6-item seed vs new 4-item DEFAULT_LANDING). The superadmin can set the FoodDrink icon via the settings panel.
- Migration is idempotent: the WHERE clause means re-running it is a no-op once updated.
---
*Phase: 49-db-seeds-color-branding*
*Completed: 2026-05-25*
