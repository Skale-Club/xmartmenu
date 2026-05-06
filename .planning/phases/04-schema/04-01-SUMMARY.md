---
phase: 04-schema
plan: 01
subsystem: database
tags: [postgres, supabase, rls, migrations, sql]

# Dependency graph
requires: []
provides:
  - "product_option_groups table with RLS, updated_at trigger, indices (ORD-01)"
  - "product_options table with RLS, updated_at trigger, indices (ORD-02)"
  - "orders.status CHECK updated to pending/preparing/ready/done/cancelled (ORD-03)"
  - "orders.notes TEXT nullable column (ORD-03)"
  - "order_items.selected_options JSONB nullable column (ORD-04)"
  - "Idempotent migration 021 safe to apply in Supabase SQL Editor"
affects: [04-02, 05-api, 06-cart, 07-ui, 08-orders]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent SQL migration with IF NOT EXISTS guards and DO $$ blocks for policies/triggers"
    - "TEXT + CHECK constraints for enumerated fields (not PostgreSQL enums)"
    - "auth_tenant_id() + is_superadmin() for RLS policies on multi-tenant tables"
    - "UPDATE rows before DROP+ADD CONSTRAINT to avoid CHECK constraint violation on existing data"

key-files:
  created:
    - "supabase/migrations/021_orders_v11_schema.sql"
  modified: []

key-decisions:
  - "Migration 021 does NOT touch orders_public_insert policy — already fixed in migration 020"
  - "base_price is nullable (NUMERIC(10,2) no NOT NULL) to distinguish absolute option price from additive price_modifier"
  - "Status migration: UPDATE confirmed->preparing and completed->done BEFORE adding new CHECK constraint"
  - "translations JSONB columns are NOT NULL DEFAULT '{}'::jsonb — consistent with project convention"

patterns-established:
  - "Pattern: Always UPDATE existing rows to new values before replacing CHECK constraints"
  - "Pattern: New v1.1 tables follow same RLS structure as menus table in migration 019"

requirements-completed: [ORD-01, ORD-02, ORD-03, ORD-04]

# Metrics
duration: 1min
completed: 2026-05-06
---

# Phase 04 Plan 01: Orders v1.1 Database Schema Summary

**Idempotent SQL migration extending the v1.0 schema with product_option_groups, product_options tables and orders/order_items column additions for the full Orders v1.1 feature set**

## Performance

- **Duration:** 1 min
- **Started:** 2026-05-06T13:02:18Z
- **Completed:** 2026-05-06T13:03:21Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Single idempotent migration file `021_orders_v11_schema.sql` covers all 4 requirements (ORD-01..04)
- Two new tables created: `product_option_groups` (with type/price_rule CHECK, RLS, trigger, indices) and `product_options` (with nullable base_price, price_modifier, RLS, trigger, indices)
- Two existing tables altered: `orders` (status constraint replaced + notes column) and `order_items` (selected_options JSONB column)
- All statements idempotent — safe to re-run in Supabase SQL Editor; no side effects on second run

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 021_orders_v11_schema.sql** - `506abd2` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `supabase/migrations/021_orders_v11_schema.sql` — Idempotent migration adding product_option_groups, product_options tables and altering orders/order_items for v1.1 Orders spec

## Decisions Made

- Migration 021 deliberately does NOT recreate or modify the `orders_public_insert` RLS policy — it was already fixed in migration 020 with the proper `orders_enabled` gate. Adding it again would cause a no-op at best or a policy-name collision error.
- `base_price` on `product_options` is nullable with no NOT NULL constraint, distinguishing it from `price_modifier` (NOT NULL DEFAULT 0). This is intentional: `base_price` represents an absolute price (used for pizza sizes/half-and-half), `price_modifier` is an additive delta (used for toppings).
- Status UPDATE statements appear BEFORE the DROP+ADD CONSTRAINT block to avoid PostgreSQL rejecting the new CHECK constraint against existing rows with old status values.

## Deviations from Plan

None — plan executed exactly as written. The migration file matches the exact content specified in the plan's `<action>` block with all correctness rules applied correctly.

## Issues Encountered

None — the migration file was clean on first write. All 15 acceptance criteria passed.

## User Setup Required

**Manual step required to apply migration in production:**

1. Open Supabase Dashboard for the xmartmenu project
2. Navigate to SQL Editor
3. Paste and run the contents of `supabase/migrations/021_orders_v11_schema.sql`
4. After running: Dashboard → API → Reload schema cache

This migration is idempotent — safe to re-run if needed.

## Known Stubs

None — this plan is a pure SQL migration with no UI stubs or placeholder values.

## Next Phase Readiness

- Database schema foundation for all v1.1 Orders features is complete
- Phase 04-02 (TypeScript type extensions in `src/types/database.ts`) can proceed immediately — the SQL tables now match what the types will describe
- Phases 05-08 (API, cart, UI, orders) can proceed once migration is applied to production Supabase

---
*Phase: 04-schema*
*Completed: 2026-05-06*
