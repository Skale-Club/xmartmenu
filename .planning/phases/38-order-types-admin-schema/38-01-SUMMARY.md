---
phase: 38-order-types-admin-schema
plan: "01"
subsystem: database
tags: [postgres, migration, typescript, tenant-settings]

# Dependency graph
requires: []
provides:
  - "Migration 034: 5 order-type columns on tenant_settings with IF NOT EXISTS guards"
  - "scripts/apply-migration-034.mjs: migration runner following established pattern"
  - "TenantSettings TypeScript interface: 5 new typed fields for dine-in, pick-up, delivery config"
affects:
  - 38-02 (StoreClient.tsx admin UI for order types — needs these typed fields)
  - 39 (Phase 39 customer order flows — reads these settings at checkout)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IF NOT EXISTS on every ADD COLUMN for idempotent migration re-runs"
    - "apply-migration-N.mjs runner reading .env.local + pg.Client pattern"
    - "TenantSettings comment style: // ORD-NN: description (migration NNN, default X)"

key-files:
  created:
    - supabase/migrations/034_order_types_tenant_settings.sql
    - scripts/apply-migration-034.mjs
  modified:
    - src/types/database.ts

key-decisions:
  - "5 new columns on tenant_settings (same table-extension pattern as migrations 025-027)"
  - "Defaults: dine_in_enabled=true, pickup/delivery=false, pickup_eta_minutes=20, delivery_fee_cents=0 — preserves existing tenant behaviour"
  - "delivery_fee_cents stored as integer cents — display conversion to dollars deferred to Plan 02 UI"

patterns-established:
  - "Order-type DB design: 3 boolean flags + 2 numeric config fields on tenant_settings"

requirements-completed:
  - ORD-01
  - ORD-02
  - ORD-03

# Metrics
duration: 2min
completed: 2026-05-19
---

# Phase 38 Plan 01: Order Types Schema Summary

**Migration 034 adding 5 order-type columns to tenant_settings plus TypeScript TenantSettings interface update — applied to production DB successfully.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-19T15:18:06Z
- **Completed:** 2026-05-19T15:20:17Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Migration 034 SQL with IF NOT EXISTS guards on all 5 columns (idempotent, re-run safe)
- Runner script `apply-migration-034.mjs` following established apply-migration-033 pattern — applied successfully against production DB
- `TenantSettings` interface extended with 5 typed fields: `dine_in_enabled`, `pickup_enabled`, `delivery_enabled`, `pickup_eta_minutes`, `delivery_fee_cents`

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration SQL 034 with IF NOT EXISTS guards** - `2f0e911` (feat)
2. **Task 2: Create apply-migration-034.mjs runner + add 5 fields to TenantSettings** - `62ee895` (feat)

## Files Created/Modified

- `supabase/migrations/034_order_types_tenant_settings.sql` — 5 ADD COLUMN IF NOT EXISTS statements on tenant_settings
- `scripts/apply-migration-034.mjs` — migration runner (exact pattern from apply-migration-033.mjs)
- `src/types/database.ts` — TenantSettings interface extended with 5 order-type fields

## Decisions Made

- Defaults chosen to preserve all existing tenant behaviour: dine-in already the norm (true), pick-up/delivery opt-in (false), ETA 20min, fee 0 cents
- No RLS changes, no indices, no data backfill needed — pure schema addition

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Migration was applied automatically** via `node scripts/apply-migration-034.mjs` during Task 2 execution. Output confirmed: "Migration 034 applied successfully."

No further manual DB steps required.

## Next Phase Readiness

- Migration 034 applied to production — 5 columns live in `tenant_settings`
- `TenantSettings` TypeScript interface fully typed — Plan 02 can add form fields without any type casting
- Plan 02 (StoreClient.tsx "Order Types" section) is unblocked and ready to execute

---
*Phase: 38-order-types-admin-schema*
*Completed: 2026-05-19*
