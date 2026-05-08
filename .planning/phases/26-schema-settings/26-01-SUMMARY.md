---
phase: 26-schema-settings
plan: 01
subsystem: database, api, ui
tags: [kds, tenant-settings, supabase, typescript, react, postgres]

# Dependency graph
requires:
  - phase: 25-ingredient-customization
    provides: ingredient_customization_enabled pattern on tenant_settings; KDS OrderCard and useElapsedTime baseline
provides:
  - Migration 027: amber_threshold_minutes + red_threshold_minutes columns in tenant_settings (defaults 10/20)
  - Parameterised useElapsedTime hook (amberMinutes, redMinutes params)
  - OrdersClient + OrderCard prop threading for per-tenant thresholds
  - StoreClient KDS section with validation and persistence
affects: [27-filter-chips-sound]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parameterised React hook: hook accepts threshold params with defaults so caller controls urgency bands"
    - "Parallel Promise.all fetch in server page: orders + tenant_settings fetched simultaneously"
    - "Form validation before upsert: amber < red and both > 0 checked client-side before DB call"

key-files:
  created:
    - supabase/migrations/027_kds_thresholds.sql
    - scripts/apply-migration-027.mjs
  modified:
    - src/types/database.ts
    - src/app/(admin)/orders/useElapsedTime.ts
    - src/app/(admin)/orders/OrdersClient.tsx
    - src/app/(admin)/orders/page.tsx
    - src/app/(admin)/settings/store/StoreClient.tsx

key-decisions:
  - "useElapsedTime accepts amberMinutes/redMinutes with defaults 10/20 — backward-compatible; callers without settings still work"
  - "orders/page.tsx uses Promise.all for parallel fetch — adds no latency vs single fetch"
  - "StoreClient validation: amber >= red and either <= 0 block upsert — prevents nonsensical KDS config"
  - "Migration applied via node scripts/apply-migration-027.mjs using DATABASE_URL from .env.local"

patterns-established:
  - "KDS threshold prop threading: page.tsx fetches settings -> passes to Client -> Client passes to card component -> hook"

requirements-completed: [KDS-07, KDS-08, KDS-09]

# Metrics
duration: ~2.5min
completed: 2026-05-08
---

# Phase 26 Plan 01: Schema + Settings Summary

**Per-tenant KDS time thresholds: migration 027 adds amber/red columns (defaults 10/20), hook parameterised, settings UI wired with validation.**

## Performance

- **Duration:** ~2.5 min
- **Started:** 2026-05-08T18:00:16Z
- **Completed:** 2026-05-08T18:02:45Z
- **Tasks:** 2 completed
- **Files modified:** 7

## Accomplishments

- Migration 027 applied to Supabase: `amber_threshold_minutes INT DEFAULT 10` and `red_threshold_minutes INT DEFAULT 20` on `tenant_settings` — existing tenants automatically get 10/20 defaults
- `useElapsedTime` hook refactored from hardcoded constants to `amberMinutes`/`redMinutes` parameters with defaults — fully backward-compatible
- `OrdersClient` + `OrderCard` prop threading complete: page.tsx fetches settings via `Promise.all`, passes thresholds down, hook called with 3 arguments
- `StoreClient` KDS section: two number inputs (1-120 range), validation prevents amber >= red or either <= 0, existing `...form` upsert spread includes new fields automatically

## Task Commits

1. **Task 1: Migration 027 + TypeScript types (KDS-07)** - `2873b34` (feat)
2. **Task 2: useElapsedTime refactor + OrdersClient threading + StoreClient KDS section (KDS-08, KDS-09)** - `de3d02b` (feat)

## Files Created/Modified

- `supabase/migrations/027_kds_thresholds.sql` - Safe ALTER TABLE with IF NOT EXISTS for both threshold columns
- `scripts/apply-migration-027.mjs` - Node.js pg client runner that reads DATABASE_URL and applies 027
- `src/types/database.ts` - TenantSettings extended with amber_threshold_minutes and red_threshold_minutes
- `src/app/(admin)/orders/useElapsedTime.ts` - Removed AMBER_MINUTES/RED_MINUTES constants; hook now accepts amberMinutes/redMinutes params
- `src/app/(admin)/orders/OrdersClient.tsx` - OrdersClientProps and OrderCard props extended; useElapsedTime called with 3 args
- `src/app/(admin)/orders/page.tsx` - Parallel fetch of orders + settings; passes amberThreshold/redThreshold to OrdersClient
- `src/app/(admin)/settings/store/StoreClient.tsx` - KDS section added after Ordering; form state, validation, and two number inputs

## Decisions Made

- `useElapsedTime` accepts params with defaults 10/20 — no existing callers break
- `orders/page.tsx` uses `Promise.all` for parallel fetch — zero added latency
- StoreClient validation runs before upsert — prevents nonsensical KDS config reaching DB
- Migration applied via pg client script using DATABASE_URL (consistent with project pattern; Supabase SQL Editor also valid)

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `supabase/migrations/027_kds_thresholds.sql`: FOUND
- `scripts/apply-migration-027.mjs`: FOUND
- `src/types/database.ts` (amber_threshold_minutes): FOUND
- `src/app/(admin)/orders/useElapsedTime.ts` (amberMinutes): FOUND
- `src/app/(admin)/orders/OrdersClient.tsx` (amberThreshold): FOUND
- `src/app/(admin)/orders/page.tsx` (amber_threshold_minutes): FOUND
- `src/app/(admin)/settings/store/StoreClient.tsx` (amber_threshold_minutes): FOUND
- Commit `2873b34`: FOUND
- Commit `de3d02b`: FOUND
- `npx tsc --noEmit`: 0 errors
- `grep AMBER_MINUTES/RED_MINUTES src/`: empty (constants removed)
