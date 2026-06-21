---
phase: 52-producer-hooks
plan: 01
subsystem: integrations
tags: [qstash, upstash, xphere, crm, fail-open, producer]

# Dependency graph
requires:
  - phase: 51-xphere-foundation
    provides: SyncReason union and worker zod schema (src/lib/xphere/types.ts, src/app/api/internal/xphere-sync/route.ts)
provides:
  - Fail-open QStash producer enqueueXphereSync — the single choke point that publishes Xphere sync jobs
affects: [52-02, 52-03, 52-04, onboarding-wiring, stripe-webhook-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single fail-open producer choke point — try/catch centralized so every call site is fail-open for free"
    - "Env-presence gate mirrored from rate-limit.ts (null client when token unset → silent no-op)"

key-files:
  created:
    - src/lib/xphere/queue.ts
  modified: []

key-decisions:
  - "Centralized the publish try/catch in one producer so every Phase 52 call site is non-blocking by construction"
  - "Resolve the publish URL identically to the worker (XPHERE_WORKER_URL → NEXT_PUBLIC_APP_URL) so QStash signature verification matches"

patterns-established:
  - "Pattern: fail-open env gate — module-level client = token ? new Client() : null; no client or no URL → silent no-op"
  - "Pattern: thin queue message — publish only { tenantId, reason, eventId?, tags? }; worker fat-reads live state"

requirements-completed: [FND-03]

# Metrics
duration: 2min
completed: 2026-06-21
---

# Phase 52 Plan 01: Fail-open QStash Producer Summary

**Fail-open `enqueueXphereSync` producer using @upstash/qstash — the single choke point that publishes a thin `{ tenantId, reason, eventId?, tags? }` job, ships dark when env is unset, and never throws into onboarding or Stripe webhooks.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-21T09:37:53Z
- **Completed:** 2026-06-21T09:39:05Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `src/lib/xphere/queue.ts` exporting `enqueueXphereSync(tenantId, reason, opts?)` — the only function that publishes to QStash.
- Fail-open by construction: silent no-op when `QSTASH_TOKEN` or the worker URL is unset; logs-and-swallows publish errors; never throws.
- Message contract matches the existing worker zod schema exactly (`tenantId`, `reason`, optional `eventId`/`tags`) so enqueued jobs validate.
- Publish target resolves identically to the worker (`XPHERE_WORKER_URL` → `NEXT_PUBLIC_APP_URL`) so QStash signature verification lines up.
- `deduplicationId: xphere:${tenantId}:${reason}` and `retries: 5` per the FND-03 contract.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create fail-open QStash producer src/lib/xphere/queue.ts** - `6a104ef` (feat)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/lib/xphere/queue.ts` - Fail-open QStash producer `enqueueXphereSync`; env-gated dark, thin message body, dedup + retries, no throw path.

## Decisions Made
- Resolved the publish URL via a `resolveWorkerUrl()` helper mirroring the worker's resolution so the QStash signature the worker verifies against its URL constant matches the URL published to.
- Spread `eventId`/`tags` into the body only when present, keeping the worker's optional zod fields genuinely optional.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. `npx tsc --noEmit` passed on first run. (Note: the acceptance criterion "`grep -c throw` returns 0" matches comment text containing the words "throw"/"rethrow"; the file contains NO `throw` statement, which is the actual invariant — verified by inspection: all 4 matches are in comments.)

## User Setup Required
None - no external service configuration required for this plan. The producer ships dark; activation happens when `QSTASH_TOKEN` and `XPHERE_WORKER_URL`/`NEXT_PUBLIC_APP_URL` are provisioned (env-level, no code change).

## Next Phase Readiness
- `enqueueXphereSync` is ready to be imported by Wave 2 producer wiring (52-02, 52-03) and the offline check (52-04).
- No barrel added; consumers import directly from `src/lib/xphere/queue`.

## Self-Check: PASSED

- FOUND: src/lib/xphere/queue.ts
- FOUND: .planning/phases/52-producer-hooks/52-01-SUMMARY.md
- FOUND: commit 6a104ef

---
*Phase: 52-producer-hooks*
*Completed: 2026-06-21*
