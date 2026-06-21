---
phase: 54-observability-ops
plan: 02
subsystem: infra
tags: [xphere, qstash, kill-switch, observability, ops, secret-hygiene]

# Dependency graph
requires:
  - phase: 51-worker-client
    provides: "isXphereEnabled() client-side kill-switch semantics that the producer gate mirrors"
  - phase: 52-producer-hooks
    provides: "enqueueXphereSync producer choke point (the only QStash publish site)"
provides:
  - "Producer-authoritative XPHERE_SYNC_ENABLED kill switch — one env flip halts all syncing with no code change"
  - "Confirmed secret hygiene: zero NEXT_PUBLIC_ Xphere/QStash vars in src/"
  - "README ops note: kill switch, DLQ, post-deploy reachability check"
affects: [55-live-conformance, ops, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Producer-authoritative kill switch: gate at the publish source (fail-open, never throws), client gate stays as defense-in-depth"

key-files:
  created:
    - .planning/phases/54-observability-ops/54-02-SUMMARY.md
  modified:
    - src/lib/xphere/queue.ts
    - README.md

key-decisions:
  - "Producer gate checks ONLY the kill-switch flag (creds belong to the worker, not the producer), keeping it simpler than client.ts isXphereEnabled"
  - "Kill switch added as an early silent return BEFORE the existing env-presence gate, never throwing — fail-open preserved"
  - ".env.example left unchanged: all 8 required Xphere/QStash vars and the server-only comment were already present and complete"

patterns-established:
  - "Safe-dark kill switch: disabled unless XPHERE_SYNC_ENABLED is a truthy non-'false'/'0' value"

requirements-completed: [OBS-02]

# Metrics
duration: 2min
completed: 2026-06-21
---

# Phase 54 Plan 02: Xphere Kill Switch + Ops Hardening Summary

**Producer-authoritative XPHERE_SYNC_ENABLED kill switch in queue.ts (fail-open preserved), confirmed zero NEXT_PUBLIC_ secret leaks in src/, and a README ops note covering kill switch + DLQ + post-deploy 401 reachability check.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-06-21T10:24:12Z
- **Completed:** 2026-06-21T10:26:03Z
- **Tasks:** 2
- **Files modified:** 2 (queue.ts, README.md)

## Accomplishments
- `enqueueXphereSync` is now a silent no-op BEFORE any QStash publish when `XPHERE_SYNC_ENABLED` is unset/`false`/`0` — the producer is the authoritative gate, flippable with a single env change.
- The new `isSyncEnabled()` helper mirrors client.ts's kill-switch truthiness but gates only on the flag and never throws; the publish try/catch fail-open behavior is untouched.
- Verified secret hygiene: zero `NEXT_PUBLIC_(XPHERE|QSTASH)` matches anywhere under `src/`.
- Added a concise `## Xphere CRM Sync — Ops` README section documenting the kill switch, QStash DLQ, the unsigned-POST → 401 reachability check, and the server-only secrets rule.

## Task Commits

Each task was committed atomically:

1. **Task 1: Gate producer on XPHERE_SYNC_ENABLED before publish** - `b65e15c` (feat)
2. **Task 2: Secret hygiene + .env.example + README ops note** - `42f24f8` (docs)

**Plan metadata:** committed separately (docs: complete plan)

## Files Created/Modified
- `src/lib/xphere/queue.ts` - Added `isSyncEnabled()` helper and an early `if (!isSyncEnabled()) return` before the existing `if (!client || !url) return` env gate; publish try/catch unchanged.
- `README.md` - Appended `## Xphere CRM Sync — Ops` section (kill switch, DLQ, reachability check, server-only secrets).
- `.env.example` - No change required; all 8 Xphere/QStash vars and the server-only comment were already present.

## Decisions Made
- Producer gate checks only the kill-switch flag, not creds — creds are the worker's concern; this keeps the producer gate authoritative yet simple.
- The kill-switch gate is an early silent return placed before the env-presence gate, so it can never throw into onboarding or a Stripe webhook (fail-open preserved).
- Left `.env.example` untouched since it already satisfied every acceptance criterion (placeholders + server-only comment).

## Deviations from Plan

None - plan executed exactly as written. (Task 2 Part A and the .env.example portion were confirm-only; no edits were needed because secret hygiene and var completeness were already in place.)

## Issues Encountered
- README.md was not pre-loaded (the files_to_read path resolved as missing initially), so it was read before editing per the Edit precondition. No impact.

## Known Stubs
None — both changes are fully wired. The kill switch is the documented intended dark/off state, not a stub.

## User Setup Required
None - no external service configuration required by this plan. Activation steps (set `XPHERE_SYNC_ENABLED=true` plus creds) are documented in the new README ops note.

## Next Phase Readiness
- OBS-02 complete: kill switch authoritative, secrets server-only, ops note in place.
- Phase 54 remaining: 54-03. Phase 55 (live conformance) stays blocked on the external Xphere `/api/v1/sync` endpoint.

## Self-Check: PASSED

- FOUND: src/lib/xphere/queue.ts
- FOUND: README.md
- FOUND: .planning/phases/54-observability-ops/54-02-SUMMARY.md
- FOUND commit: b65e15c (Task 1)
- FOUND commit: 42f24f8 (Task 2)

---
*Phase: 54-observability-ops*
*Completed: 2026-06-21*
