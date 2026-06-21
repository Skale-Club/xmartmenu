---
phase: 50-schema-contract
plan: 03
subsystem: testing
tags: [xphere, crm, tsx, assert, offline-gate, mapper]

# Dependency graph
requires:
  - phase: 50-schema-contract (plan 02)
    provides: pure buildSyncPayload/normalizeMrr/selectStage mapper and XPHERE_STAGES/types
provides:
  - Offline, credential-free assertion gate (scripts/xphere-mapping-check.ts) for the pure Xphere mapper
  - npm run xphere:check script — non-zero exit on any assertion failure (usable as CI/pre-commit gate)
affects: [51-worker-client, 52-producer-hooks, 53-backfill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Offline tsx assertion gate using node:assert/strict (throws -> non-zero exit), no test runner"
    - "Single canonical mapper check named xphere:check; no duplicate scripts"

key-files:
  created:
    - scripts/xphere-mapping-check.ts
  modified:
    - package.json

key-decisions:
  - "Consolidated plan 50-02's scripts/test-xphere-mapping.ts (test:xphere) into the canonical scripts/xphere-mapping-check.ts (xphere:check) — exactly one offline mapper gate, no duplication."
  - "Switched the gate from a custom failure counter to node:assert/strict so a failed assertion throws and exits non-zero automatically (true gate, not eyeball)."

patterns-established:
  - "Mapper correctness (idempotency key, stage model, normalized MRR, note dedup) is locked behind a runnable offline gate before any network code exists."

requirements-completed: [FND-02]

# Metrics
duration: ~6min
completed: 2026-06-21
---

# Phase 50 Plan 03: Offline Xphere Mapper Gate Summary

**Credential-free `npm run xphere:check` (node:assert/strict tsx script) asserts MRR normalization, stage selection via XPHERE_STAGES, external_id keying on all three entities, payload shape, and note dedup against fixtures — consolidating the prior duplicate harness into one canonical gate.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-21T08:48Z
- **Completed:** 2026-06-21
- **Tasks:** 1
- **Files modified:** 2 (1 created, 1 modified, 1 deleted)

## Accomplishments
- Created `scripts/xphere-mapping-check.ts` — a self-contained offline gate using only `node:assert/strict` and the pure mapper. No dotenv/Supabase/QStash/fetch imports, no env reads.
- Asserts: annual MRR = annual_price/12 (=100) and monthly MRR = monthly_price (=49); reason-priority and status-fallback stage selection driven by `XPHERE_STAGES`; `external_id = tenant.id` on account/contact/opportunity; full payload shape (source, names, role, stage, amount, currency, tags); note dedup fallback (`eventId` vs `onboarding:<tenant.id>`); plus null-owner tolerance, note omission, and determinism.
- Wired `xphere:check` npm script (`npx tsx scripts/xphere-mapping-check.ts`); `npm run xphere:check` exits 0 on pass and non-zero on any failure.
- Consolidated the duplicate harness from plan 50-02: removed `scripts/test-xphere-mapping.ts` and the `test:xphere` npm entry, leaving exactly one canonical gate.

## Task Commits

Each task was committed atomically:

1. **Task 1: Consolidate offline mapper gate into xphere:check** - `55cad37` (test)

**Plan metadata:** (final docs commit below)

## Files Created/Modified
- `scripts/xphere-mapping-check.ts` - Offline `node:assert/strict` gate for the pure Xphere mapper (created)
- `package.json` - Replaced `test:xphere` with `xphere:check` script (modified)
- `scripts/test-xphere-mapping.ts` - Removed (duplicate of the new canonical gate)

## Decisions Made
- Per the execution reconciliation, consolidated to the plan's canonical names (`scripts/xphere-mapping-check.ts` + `xphere:check`) rather than creating a second script, keeping exactly one offline mapper gate.
- Used `node:assert/strict` (per the plan) instead of the prior custom PASS/FAIL counter, so a failed assertion throws and produces a non-zero exit automatically.

## Deviations from Plan

None - plan executed as written, with the pre-agreed consolidation of the plan 50-02 harness (rename to the canonical path/script name and removal of the duplicate). No code outside scope was touched; the Xphere repo was not modified.

## Issues Encountered
None. The new gate passes (`EXIT=0`) both directly via tsx and through `npm run xphere:check`; ESLint on the new file is clean. A grep-based negative check appeared to flag a forbidden import but matched only the word "dotenv" inside a descriptive comment — verified there are no actual dotenv/Supabase/QStash imports and no `process.env` reads.

## User Setup Required
None - no external service configuration required (offline, credential-free).

## Next Phase Readiness
- Phase 50 success criterion 4 satisfied: the pure mapper is exercised offline with no network and no credentials, behind a runnable gate.
- Phase 51 (Worker + Client) can rely on `npm run xphere:check` as a regression gate for the mapper as network code is added around it.

## Self-Check: PASSED

- FOUND: scripts/xphere-mapping-check.ts
- FOUND: .planning/phases/50-schema-contract/50-03-SUMMARY.md
- REMOVED: scripts/test-xphere-mapping.ts (duplicate)
- FOUND commit: 55cad37

---
*Phase: 50-schema-contract*
*Completed: 2026-06-21*
