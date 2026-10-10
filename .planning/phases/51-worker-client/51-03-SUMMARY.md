---
phase: 51-worker-client
plan: 03
subsystem: integrations
tags: [xphere, crm, qstash, retry-classification, tsx, node-assert, offline-gate]

# Dependency graph
requires:
  - phase: 51-01
    provides: "XphereTransientError / XpherePermanentError classes, postXphereSync client + PostXphereResult type"
  - phase: 51-02
    provides: "POST /api/internal/xphere-sync worker route with inline 200/489/500 + Upstash-NonRetryable-Error decisions"
  - phase: 50
    provides: "buildSyncPayload pure mapper (external_id-keyed payload), XphereSyncResponse type"
provides:
  - "src/lib/xphere/classify.ts: pure classifyWorkerOutcome() + nonRetryableHeaders() — single source of truth for retry vs DLQ vs ack"
  - "xphere-sync route now derives all retry-classification responses from the shared classifier (no duplicated literals)"
  - "scripts/xphere-worker-check.ts: offline assertion gate for the classification table + fat-read->map->write-back wiring with a stubbed client"
  - "npm run xphere:worker:check script"
affects: [52-producer-hooks, 55-live-conformance-test]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure classification function shared by route + offline gate (single source of truth)"
    - "tsx + node:assert/strict offline gate convention extended to the worker (no env/network/creds, stubbed client)"

key-files:
  created:
    - src/lib/xphere/classify.ts
    - scripts/xphere-worker-check.ts
  modified:
    - src/app/api/internal/xphere-sync/route.ts
    - package.json

key-decisions:
  - "Unknown/unexpected throws are conservatively classified transient (500 -> retry), only XpherePermanentError dead-letters"
  - "Missing-plan path reuses the permanent error branch via classifyWorkerOutcome({ kind: 'error', error: new XpherePermanentError(...) }) to keep one classification table"
  - "Signature-verify 401 stays a direct literal — it is auth, not retry classification"

patterns-established:
  - "Worker decisions are encoded as a pure function and asserted exactly where they are consumed"
  - "Offline gates stub the network seam (PostXphereResult) instead of mocking fetch"

requirements-completed: [FND-06]

# Metrics
duration: 14min
completed: 2026-06-21
---

# Phase 51 Plan 03: Worker Retry-Classification Gate Summary

**Pure `classifyWorkerOutcome()` (transient->500, permanent->489+Upstash-NonRetryable-Error, disabled/gone/success->200) consumed by the xphere-sync route and locked behind an offline `npm run xphere:worker:check` gate that also asserts the fat-read->buildSyncPayload->write-back wiring with a stubbed client.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-21
- **Completed:** 2026-06-21
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Extracted the worker's riskiest decision (retry vs DLQ vs ack) into a pure, exported `classifyWorkerOutcome()` + `nonRetryableHeaders()` in `src/lib/xphere/classify.ts` — no I/O, no env, no network.
- Refactored the Plan 02 route so every 200/489/500 + `Upstash-NonRetryable-Error` response derives from the shared classifier (single source of truth), with verify-first / 401 / fat-read / write-back logic untouched.
- Added `scripts/xphere-worker-check.ts`: a `node:assert/strict` offline gate asserting the full classification table AND the fat-read->`buildSyncPayload` (external_id-keyed) -> stubbed-client -> write-back wiring with no QStash/Xphere creds and no real fetch.
- Wired `npm run xphere:worker:check` (mirrors the existing `xphere:check` convention); it exits 0 and prints "all assertions passed". `tsc --noEmit` stays green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract pure classifyWorkerOutcome (classify.ts)** - `45008d6` (feat)
2. **Task 2: Route consumes classifyWorkerOutcome (single source of truth)** - `b05966a` (refactor)
3. **Task 3: Offline worker check script + npm script** - `44ce824` (test)

_Note: Task 1 was tdd-flagged; since the offline gate (Task 3) is the test harness for this module, the classifier was authored to the documented behavior table and validated by Task 3's assertions — no separate RED/GREEN test-file commit was created, matching the repo's no-test-runner convention._

## Files Created/Modified
- `src/lib/xphere/classify.ts` - Pure `WorkerOutcome -> WorkerVerdict` classifier + `nonRetryableHeaders()`. Single source of truth for the retry table.
- `src/app/api/internal/xphere-sync/route.ts` - All retry-classification responses now derived from `classifyWorkerOutcome`; removed the inline `NON_RETRYABLE` constant.
- `scripts/xphere-worker-check.ts` - Offline `tsx` gate: GROUP A asserts the classification table + DLQ header; GROUP B asserts fat-read->map->write-back with a stubbed `PostXphereResult` client.
- `package.json` - Added `xphere:worker:check` script.

## Decisions Made
- **Unknown throws are transient.** Only `XpherePermanentError` dead-letters (489); `XphereTransientError` and any other unexpected throw return a retryable 500, so a bug never silently drops a sync.
- **Missing-plan reuses the permanent branch.** Rather than a new outcome kind, the route passes `{ kind: 'error', error: new XpherePermanentError('no subscription') }` so the 489/DLQ path lives in exactly one place.
- **Stub the network seam, not fetch.** The offline gate's `stubPostXphereSync` returns a typed `PostXphereResult` so the write-back wiring is asserted contract-faithfully with zero network/creds.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. `tsc --noEmit` and `npm run xphere:worker:check` were green on first run after each task.

## User Setup Required
None - no external service configuration required. The classifier and gate are pure/offline; the feature still ships dark behind the `XPHERE_*` env gate.

## Next Phase Readiness
- The retry-vs-DLQ-vs-ack contract is now provable offline, unblocking Phase 52 (producer hooks) to enqueue against a worker whose failure semantics are locked.
- Phase 55 (live conformance) remains deferred until Xtimator's `/api/v1/sync` endpoint + credentials land — only real signature/endpoint conformance is outstanding.

## Self-Check: PASSED

- Files verified present: `src/lib/xphere/classify.ts`, `scripts/xphere-worker-check.ts`, `51-03-SUMMARY.md`
- Commits verified present: `45008d6`, `b05966a`, `44ce824`
- `npx tsc --noEmit` exits 0; `npm run xphere:worker:check` exits 0 ("all assertions passed")

---
*Phase: 51-worker-client*
*Completed: 2026-06-21*
