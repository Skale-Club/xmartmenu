---
phase: 54-observability-ops
plan: 03
subsystem: testing
tags: [tsx, node-assert, qstash, kill-switch, offline-gate, observability]

# Dependency graph
requires:
  - phase: 54-observability-ops (54-01)
    provides: superadmin xphere-resync route (assertSuperadmin + enqueueXphereSync(id,'manual'))
  - phase: 54-observability-ops (54-02)
    provides: producer-authoritative XPHERE_SYNC_ENABLED kill switch in queue.ts
provides:
  - Offline tsx gate (scripts/xphere-obs-check.ts) asserting OBS-01 resync route structure + OBS-02 producer kill switch
  - npm run xphere:check:obs wired into package.json
affects: [55-live-conformance, observability-ops]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Offline assertion gate mirroring scripts/xphere-queue-check.ts (node:assert/strict, fetch stubbed, dummy-env-before-dynamic-import, main().catch -> process.exit(1))"
    - "Structural route assertion via readFileSync(new URL(...,import.meta.url)) when the real guard needs cookies/Supabase"

key-files:
  created:
    - scripts/xphere-obs-check.ts
  modified:
    - package.json

key-decisions:
  - "Kill-switch blocks set valid QSTASH_TOKEN + XPHERE_WORKER_URL so the ONLY thing suppressing publish is XPHERE_SYNC_ENABLED itself (the kill switch gate runs before the client/url gate in queue.ts) — isolates OBS-02 from the existing fail-open env gate covered by xphere:check:queue."
  - "OBS-01 verified structurally (readFileSync + assert.match) since the real assertSuperadmin needs cookies/Supabase — same convention as xphere-backfill-check.ts."

patterns-established:
  - "Per-invariant offline gate per phase, wired as npm run xphere:check:<scope>, tsc-clean, no creds/network."

requirements-completed: [OBS-01, OBS-02]

# Metrics
duration: 2min
completed: 2026-06-21
---

# Phase 54 Plan 03: OBS Offline Gate Summary

**Offline tsx gate (scripts/xphere-obs-check.ts) proving the producer kill switch no-ops when XPHERE_SYNC_ENABLED is disabled (unset/'false'/'0') and publishes exactly once when enabled, plus a structural assertion that the resync route is superadmin-gated and calls enqueueXphereSync(id, 'manual').**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-21T10:28:06Z
- **Completed:** 2026-06-21T10:30:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- New offline gate `scripts/xphere-obs-check.ts` locks the two riskiest OBS invariants behind a runnable check with no creds and no network (fetch stubbed, dummy env set before dynamic import of queue.ts).
- OBS-02 kill switch: asserts zero publish (no fetch, no throw) when XPHERE_SYNC_ENABLED is unset, 'false', or '0', and exactly one publish with the thin `{ tenantId, reason: 'manual' }` body when enabled — no regression to fail-open.
- OBS-01 resync route: structural assertion that the route gates on `assertSuperadmin`, calls `enqueueXphereSync(id, 'manual')`, returns `{ ok: true }`, and exports an async `POST` handler.
- Wired `npm run xphere:check:obs` mirroring the sibling `xphere:check:*` entries.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write scripts/xphere-obs-check.ts** - `b66c937` (test)
2. **Task 2: Wire npm run xphere:check:obs** - `6ce0ddc` (chore)

**Plan metadata:** _(final docs commit below)_

## Files Created/Modified
- `scripts/xphere-obs-check.ts` - Offline gate asserting OBS-02 kill switch (disabled -> zero publish/no throw; enabled -> one thin publish) and OBS-01 resync route structure.
- `package.json` - Added `xphere:check:obs` script mapped to `npx tsx scripts/xphere-obs-check.ts`.

## Decisions Made
- In the kill-switch blocks, valid `QSTASH_TOKEN` + `XPHERE_WORKER_URL` are configured so the kill switch is the sole reason a publish is suppressed (queue.ts runs the kill-switch gate before the client/url fail-open gate). This isolates the OBS-02 assertion from the env-presence fail-open already covered by `xphere:check:queue`.
- OBS-01 verified structurally via `readFileSync` + `assert.match` (not by invoking the route), matching `xphere-backfill-check.ts` — the real `assertSuperadmin` requires cookies/Supabase.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None. The gate passed on first run; `npx tsc --noEmit` exited 0.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 54 (Observability & Ops) is complete: all three plans (54-01 UI/route, 54-02 kill switch, 54-03 offline gate) executed and committed.
- Phase 55 (Live Conformance Test) remains BLOCKED on the external Xtimator `/api/v1/sync` endpoint, indexes, scope, and live credentials.

## Self-Check: PASSED

- FOUND: scripts/xphere-obs-check.ts
- FOUND: .planning/phases/54-observability-ops/54-03-SUMMARY.md
- FOUND: package.json `xphere:check:obs` script
- FOUND: commit b66c937 (Task 1)
- FOUND: commit 6ce0ddc (Task 2)

---
*Phase: 54-observability-ops*
*Completed: 2026-06-21*
