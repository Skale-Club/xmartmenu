---
phase: 50-schema-contract
plan: 01
subsystem: database
tags: [postgres, supabase, migration, typescript, crm, xphere]

# Dependency graph
requires: []
provides:
  - "tenants table carries five nullable xphere_* CRM sync-state columns (migration 054)"
  - "Tenant TypeScript interface mirrors the five xphere_* columns as string | null"
  - "apply-migration-054.mjs runner following the established convention"
affects: [51-worker-client, 52-producer-hooks, 53-backfill, 54-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent ALTER TABLE ... ADD COLUMN IF NOT EXISTS + COMMENT per column"
    - "external_id = tenants.id as the immutable CRM idempotency key (never email/phone)"

key-files:
  created:
    - supabase/migrations/054_xphere_sync_columns.sql
    - scripts/apply-migration-054.mjs
  modified:
    - src/types/database.ts

key-decisions:
  - "All xphere_* columns nullable; XmartMenu DB is source of truth, CRM is a one-way outbound mirror"
  - "Migration not yet applied to the DB — schema + types only, no network/queue code this plan"

patterns-established:
  - "xphere_synced_at/xphere_sync_error track per-tenant sync outcome (FND-05) on the same row as the CRM ids"

requirements-completed: [FND-01]

# Metrics
duration: 2min
completed: 2026-06-21
---

# Phase 50 Plan 01: Schema & Contract Summary

**tenants gains five nullable xphere_* CRM sync-state columns (migration 054) mirrored into the Tenant TypeScript interface; external_id = tenants.id is the documented idempotency key**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-06-21T08:39:22Z
- **Completed:** 2026-06-21T08:40:56Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Idempotent migration 054 adds `xphere_account_id`, `xphere_contact_id`, `xphere_opportunity_id` (text), `xphere_synced_at` (timestamptz), and `xphere_sync_error` (text) to `tenants`, each with a documented COMMENT.
- `apply-migration-054.mjs` runner copies the established `apply-migration-0NN.mjs` pattern (pg.Client + `.env.local` loader + `DATABASE_URL` guard) targeting migration 054.
- `Tenant` interface extended with the five fields as `string | null`, appended after `custom_domain_verified`; `tsc --noEmit` passes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create idempotent migration 054 + apply-migration-054.mjs runner** - `990bd37` (feat)
2. **Task 2: Extend the Tenant interface with five xphere_* fields** - `ced710a` (feat)

**Plan metadata:** committed separately (docs: complete plan)

## Files Created/Modified
- `supabase/migrations/054_xphere_sync_columns.sql` - Idempotent ALTER TABLE adding five nullable xphere_* sync-state columns + COMMENTs.
- `scripts/apply-migration-054.mjs` - Migration runner targeting `054_xphere_sync_columns.sql`.
- `src/types/database.ts` - `Tenant` interface extended with five `string | null` xphere_* fields.

## Decisions Made
None - followed plan as specified. The plan's intent (nullable columns, external_id = tenants.id idempotency key, schema + types only) was executed exactly.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Git emitted LF→CRLF line-ending warnings on Windows (cosmetic, no impact); both task verifications (`grep` checks and `tsc --noEmit`) passed first try.

## User Setup Required
None - no external service configuration required. Migration 054 is created but NOT yet applied to the database; apply later via `node scripts/apply-migration-054.mjs` (uses `DATABASE_URL` from `.env.local`).

## Known Stubs
None. This plan delivers schema + types only; the columns are intentionally written by later phases (51 worker, 52 hooks, 53 backfill). No UI-facing empty values introduced.

## Next Phase Readiness
- FND-01 satisfied: the `tenants` row and the `Tenant` type both carry the CRM sync-state fields the Phase 51 worker will read/write.
- No new npm dependency added; Xphere repo untouched; no network/queue code — all per plan constraints.
- Reminder: migration 054 still needs to be applied against the live DB before the worker writes real CRM ids.

## Self-Check: PASSED

---
*Phase: 50-schema-contract*
*Completed: 2026-06-21*
