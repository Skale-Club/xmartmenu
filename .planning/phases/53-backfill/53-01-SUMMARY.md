---
phase: 53-backfill
plan: 01
subsystem: integrations
tags: [xphere, crm, backfill, qstash, keyset-pagination, superadmin, tsx]

# Dependency graph
requires:
  - phase: 52-producer-hooks
    provides: enqueueXphereSync (the single fail-open QStash producer choke point) + reason 'backfill'
  - phase: 51-worker-client
    provides: idempotent worker that upserts by external_id (= tenants.id); 'backfill' emits no note
  - phase: 50-schema-contract
    provides: SyncReason union incl. 'backfill', XphereStage model, tenants xphere_* columns
provides:
  - Superadmin-only POST /api/superadmin/xphere/backfill that fans out enqueueXphereSync(id, 'backfill') over the tenants table
  - Pure dependency-injected runBackfillBatch seam (keyset-resumable, throttled, per-tenant fail-open)
  - Offline tsx gate scripts/xphere-backfill-check.ts + npm run xphere:check:backfill
affects: [54-observability, 55-live-conformance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure dependency-injected seam (runBackfillBatch) split from the I/O wiring so the route is offline-testable with no Supabase/QStash"
    - "Keyset pagination on created_at (.gt) for resumable, OFFSET-drift-free batch fan-out with nextCursor/done"
    - "Reuse the single producer choke point — no parallel CRM sync path for backfill"

key-files:
  created:
    - src/app/api/superadmin/xphere/backfill/route.ts
    - scripts/xphere-backfill-check.ts
  modified:
    - package.json

key-decisions:
  - "Backfill contains zero new sync logic — it paginates tenants and fans out the existing enqueueXphereSync(id,'backfill'), inheriting every idempotency/retry/fail-open guarantee of the Phase 52->51 path."
  - "Resumability via keyset cursor on tenants.created_at (ascending, .gt) — re-invocation with ?cursor=nextCursor continues after the last tenant; no OFFSET drift, no gap, no dup."
  - "No opt-out/internal/test/marketing-consent column invented this phase (none exists on tenants per src/types/database.ts) — sync ALL tenants; absence documented in code; skipped counter kept at 0 for forward compat."
  - "Offline gate asserts the superadmin guard structurally (reads route source for assertSuperadmin + status:401) since the real guard needs cookies/Supabase."

patterns-established:
  - "Pattern: separate a pure runBackfillBatch seam from the route POST so the riskiest invariants (fan-out, cursor advance, fail-open) are provable offline with no creds/network."
  - "Pattern: per-tenant try/catch inside the batch loop so one rejecting enqueue never aborts the remaining fan-out."

requirements-completed: [BKF-01]

# Metrics
duration: 8min
completed: 2026-06-21
---

# Phase 53 Plan 01: Xphere Backfill Summary

**Superadmin-only, keyset-resumable, throttled, per-tenant fail-open backfill that hydrates the Xphere CRM by fanning out the existing enqueueXphereSync(id, 'backfill') over every tenant — zero new sync logic — plus an offline tsx gate proving fan-out, cursor advance, and the 401 superadmin reject with no creds/network.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-21T09:57Z
- **Completed:** 2026-06-21T10:06Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `POST /api/superadmin/xphere/backfill`: assertSuperadmin-gated, keyset-paginates `tenants` on `created_at`, fans out `enqueueXphereSync(id, 'backfill')` once per tenant with a throttle, returns `{ enqueued, skipped, nextCursor, done }`.
- Pure `runBackfillBatch` seam (dependency-injected `fetchTenants` + `enqueue`) exported for offline testing — resumable, throttled, per-tenant fail-open.
- Offline gate `scripts/xphere-backfill-check.ts` + `npm run xphere:check:backfill` proving enqueue-once-per-tenant in order, cursor advance across a resumable two-call run, per-tenant fail-open, and the structural superadmin->401 guard. Exits 0 with no creds/network.
- Ships dark: with `XPHERE_*`/`QSTASH` env unset, `enqueueXphereSync` is a silent no-op, so running the backfill before credentials land is harmless.

## Task Commits

Each task was committed atomically:

1. **Task 1: Superadmin backfill route + runBackfillBatch seam** - `1ed0d01` (feat)
2. **Task 2: Offline backfill gate + npm script** - `94512f8` (test)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/app/api/superadmin/xphere/backfill/route.ts` - Superadmin POST route + pure `runBackfillBatch` seam; keyset pagination on `tenants.created_at`, fan-out to `enqueueXphereSync(id, 'backfill')`, throttle, per-tenant fail-open, `{ enqueued, skipped, nextCursor, done }` return.
- `scripts/xphere-backfill-check.ts` - Offline tsx assertion gate exercising the seam (fan-out order, cursor advance, resumability, fail-open) + structural assertSuperadmin/401 check.
- `package.json` - Added `xphere:check:backfill` npm script.

## Decisions Made
- Reuse the single Phase 52 producer choke point for backfill — no parallel CRM sync path; the backfill inherits idempotency (worker upserts by external_id; 'backfill' emits no note so re-runs never double-post), retries (QStash), and fail-open behavior for free.
- Resumability via keyset cursor on `created_at` (`.gt`, ascending) rather than OFFSET — stable across re-invocations, no drift.
- Did NOT invent an opt-out/internal/test/marketing-consent column (none exists on `tenants`). Per the Phase 53 CONTEXT decision, sync ALL tenants, document the absence in code, and keep `skipped` at 0 for forward compatibility. Flag to product before live PII flow.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. `npx tsc --noEmit` clean after both tasks; `npm run xphere:check:backfill` exits 0.

## Known Stubs
None. The `skipped` counter is intentionally hardwired to 0 (not a stub) — it is a forward-compatibility field that stays 0 until an opt-out/internal flag is added to `tenants` in a future phase; the absence is documented in the route and in CONTEXT. The route syncs all tenants, fully achieving the BKF-01 goal.

## User Setup Required
None - no external service configuration required. The backfill ships dark behind the existing `XPHERE_*`/`QSTASH` env gate; it becomes live automatically once those credentials land (Phase 55, Xtimator-owned).

## Next Phase Readiness
- BKF-01 complete: a re-runnable, resumable CRM hydration of historical tenants is in place behind the superadmin guard, ready to invoke once credentials land.
- Ready for Phase 54 (Observability & Ops) — the backfill return shape (`enqueued`/`skipped`/`nextCursor`/`done`) gives operators progress visibility for a paginated re-invocation loop.
- No blockers introduced. Phase 55 remains blocked on the external Xtimator `/api/v1/sync` deliverable (unchanged).

## Self-Check: PASSED

- FOUND: src/app/api/superadmin/xphere/backfill/route.ts
- FOUND: scripts/xphere-backfill-check.ts
- FOUND: .planning/phases/53-backfill/53-01-SUMMARY.md
- FOUND: commit 1ed0d01 (feat — route + seam)
- FOUND: commit 94512f8 (test — offline gate + npm script)
- FOUND: package.json xphere:check:backfill script
- npx tsc --noEmit exits 0; npm run xphere:check:backfill exits 0

---
*Phase: 53-backfill*
*Completed: 2026-06-21*
