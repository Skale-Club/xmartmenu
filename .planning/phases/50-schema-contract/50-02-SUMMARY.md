---
phase: 50-schema-contract
plan: 02
subsystem: api
tags: [xphere, crm, typescript, mapping, contract, tsx]

# Dependency graph
requires:
  - phase: 50-schema-contract (plan 01)
    provides: Tenant interface xphere_* columns + migration 054 (external_id = tenants.id idempotency key)
provides:
  - "src/lib/xphere/types.ts — single-source-of-truth /api/v1/sync contract, SyncReason union, XPHERE_STAGES constant"
  - "src/lib/xphere/mapping.ts — pure buildSyncPayload(input) + normalizeMrr + selectStage helpers"
  - "scripts/test-xphere-mapping.ts — offline tsx assertion harness for the pure mapper"
affects: [51-worker-client, 52-producer-hooks, 53-backfill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contract isolated in one file (types.ts) so an unfinalized external contract change touches a single file"
    - "Pure offline-testable mapper: no I/O, no getTenantPlan, no network/queue imports; resolved plan passed in as fixture-friendly input"
    - "tsx assertion script under scripts/ as the test harness (no test runner in repo)"

key-files:
  created:
    - src/lib/xphere/types.ts
    - src/lib/xphere/mapping.ts
    - scripts/test-xphere-mapping.ts
  modified:
    - package.json

key-decisions:
  - "Used a tsx assertion script (scripts/test-xphere-mapping.ts) as the test harness instead of introducing vitest — matches the existing npx tsx scripts/*.ts convention and adds no dependency"
  - "Mapper consumes an already-resolved EffectivePlan shape; Phase 51 worker owns the getTenantPlan() call so mapping.ts stays pure and offline-testable"
  - "selectStage gives reason priority over subscription status; status is the fallback for non-stage-pinning reasons (plan_changed, connect_changed, backfill, manual)"

patterns-established:
  - "Stage names referenced only via XPHERE_STAGES — never hard-coded elsewhere"
  - "Every CRM entity keyed on external_id = tenants.id; source = 'xmartmenu'"
  - "MRR computed exactly once via normalizeMrr (annual_price/12 or monthly_price), never raw plans.monthly_price"

requirements-completed: [FND-02]

# Metrics
duration: 4min
completed: 2026-06-21
---

# Phase 50 Plan 02: Xphere Contract & Pure Mapper Summary

**Typed `/api/v1/sync` contract (SyncReason + XPHERE_STAGES) isolated in one file, plus a pure, deterministic `buildSyncPayload` mapper that emits a `source='xmartmenu'` upsert payload keyed on `external_id = tenants.id` with override-resolved, annual-normalized MRR.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-21T08:42:57Z
- **Completed:** 2026-06-21T08:47:12Z
- **Tasks:** 2
- **Files created:** 3 (types.ts, mapping.ts, test script)
- **Files modified:** 1 (package.json)

## Accomplishments
- `src/lib/xphere/types.ts` is the single home for the (not-yet-finalized) Xphere contract: `SyncReason` (8 members), `XPHERE_STAGES` (Onboarding → Active → At Risk → Churned), and the typed `XphereSyncRequest`/`XphereSyncResponse` upsert shape.
- `src/lib/xphere/mapping.ts` is a fully pure, deterministic mapper: `normalizeMrr`, `selectStage`, and `buildSyncPayload`. No I/O, no `getTenantPlan`, no network/queue/Supabase imports.
- Offline assertion harness (`scripts/test-xphere-mapping.ts`, `npm run test:xphere`) covering MRR normalization, stage selection (reason + status fallback), external_id keying, dedup_id rules, null-owner tolerance, and determinism — all passing with no credentials.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define /api/v1/sync contract, SyncReason and XPHERE_STAGES** - `dea9dfb` (feat)
2. **Task 2: Pure buildSyncPayload mapper (TDD)** - `f886bff` (test, RED) → `956d915` (feat, GREEN)
3. **Tooling: test:xphere npm script** - `bafd8da` (chore)

**Plan metadata:** pending (docs: complete plan)

_Task 2 was TDD: failing assertion script committed first (f886bff), then the implementation that turned it green (956d915). No refactor commit needed — implementation was clean on first pass._

## Files Created/Modified
- `src/lib/xphere/types.ts` - SyncReason union, XPHERE_STAGES constant, typed XphereSyncRequest/Response contract (the only file to change when Xtimator finalizes the shape).
- `src/lib/xphere/mapping.ts` - Pure `buildSyncPayload(input): XphereSyncRequest` plus `normalizeMrr` and `selectStage`; imports the contract from `./types`.
- `scripts/test-xphere-mapping.ts` - Offline tsx assertions for the mapper (no network, no creds).
- `package.json` - Added `test:xphere` script.

## Decisions Made
- **tsx assertion script over vitest:** CONTEXT.md left the test-runner choice to discretion and STATE.md flagged "no test runner in repo." Chose a `scripts/test-xphere-mapping.ts` tsx harness to match the existing `npx tsx scripts/*.ts` convention and avoid adding a new dependency. The pure mapper is exercised against fixtures with zero credentials.
- **Mapper stays pure / consumes resolved plan:** `mapping.ts` accepts a `Pick<EffectivePlan,...>` shape rather than calling `getTenantPlan()`. The Phase 51 worker does the I/O and passes the resolved plan in — keeps the highest-value correctness logic offline-testable.
- **Reason-over-status stage precedence:** `selectStage` resolves the stage from `reason` first (onboarded/plan_activated/past_due/churned), falling back to subscription `status` for reasons that don't pin a stage.

## Deviations from Plan

None - plan executed exactly as written.

The `scripts/test-xphere-mapping.ts` harness and the `test:xphere` npm script were anticipated by CONTEXT.md (success criterion 4: "Add a tsx script under scripts/ ... runnable with no QStash/Xphere creds"), so they are planned tooling, not deviations.

## Issues Encountered
- The Task 2 acceptance grep matched the literal `external_id: input.tenant.id`. The initial implementation destructured `tenant` from `input` and wrote `external_id: tenant.id`, which typechecked and passed all tests but failed that exact-literal grep. Removed the destructuring so the assignments read `input.tenant.id`, satisfying the verification while keeping behavior identical (re-verified: tsc clean, all assertions pass).

## User Setup Required

None - no external service configuration required. This plan is pure schema/lib; nothing calls the network and no env vars are read.

## Next Phase Readiness
- Phase 51 (Worker + Client) can now consume the typed contract (`XphereSyncRequest`/`XphereSyncResponse`) and call the pure `buildSyncPayload` after its fat-read + `getTenantPlan()` resolution. The worker only needs to do I/O — all business logic (entity mapping, stage selection, MRR normalization, external_id keying) is done and tested here.
- Contract field names remain isolated in `types.ts`; when Xtimator finalizes `/api/v1/sync`, only that file changes.
- No blockers introduced. Phase 55 remains blocked on the external Xtimator endpoint (unchanged).

## Self-Check: PASSED

- FOUND: src/lib/xphere/types.ts
- FOUND: src/lib/xphere/mapping.ts
- FOUND: scripts/test-xphere-mapping.ts
- FOUND commit: dea9dfb (Task 1)
- FOUND commit: f886bff (Task 2 RED)
- FOUND commit: 956d915 (Task 2 GREEN)
- FOUND commit: bafd8da (tooling)

---
*Phase: 50-schema-contract*
*Completed: 2026-06-21*
