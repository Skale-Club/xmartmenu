---
phase: 51-worker-client
plan: 01
subsystem: integrations
tags: [xphere, qstash, crm, fetch, env-gate, error-classification, typescript]

# Dependency graph
requires:
  - phase: 50-schema-contract
    provides: "src/lib/xphere/types.ts — XphereSyncRequest/XphereSyncResponse contract, SyncReason, XPHERE_STAGES"
provides:
  - "@upstash/qstash@2.11.1 — the single new runtime dependency (Client publish + Receiver verify)"
  - "src/lib/xphere/errors.ts — XphereTransientError / XpherePermanentError typed classes (retry vs DLQ)"
  - "src/lib/xphere/client.ts — postXphereSync, the ONLY Xphere network seam (env-gated, single attempt, 10s timeout)"
  - "isXphereEnabled() env gate (ships dark when creds absent or XPHERE_SYNC_ENABLED falsy)"
  - ".env.example — 8 documented server-only XPHERE_*/QSTASH_* placeholders"
  - "scripts/xphere-client-check.ts — offline tsx gate for the gate + classification logic"
affects: [52-producer-hooks, 53-backfill, 54-observability, 55-live-conformance, worker-route, qstash-receiver]

# Tech tracking
tech-stack:
  added: ["@upstash/qstash@2.11.1"]
  patterns:
    - "Single network seam: all Xphere fetches isolated in one file"
    - "Env-presence gate mirroring rate-limit.ts hasUpstash (fail-dark, not fail-open)"
    - "Typed transient/permanent error classification for QStash retry-vs-DLQ"
    - "Offline tsx assertion harness (node:assert/strict) instead of a test runner"

key-files:
  created:
    - "src/lib/xphere/errors.ts"
    - "src/lib/xphere/client.ts"
    - "scripts/xphere-client-check.ts"
  modified:
    - "package.json"
    - "package-lock.json"
    - ".env.example"

key-decisions:
  - "Disabled path returns a typed { disabled: true } sentinel (not a thrown XphereDisabledError) so the worker treats dark mode as a permanent no-op without a try/catch."
  - "isXphereEnabled() requires creds present AND XPHERE_SYNC_ENABLED truthy non-'false' — explicit kill switch even after credentials land."
  - "TDD RED/GREEN done via scripts/xphere-client-check.ts tsx harness (no vitest), matching the Phase 50 scripts/*.ts convention; wrapped in main() because tsx CJS output rejects top-level await."
  - "X-Org-Id sent as a header (not body); Idempotency-Key header name isolated in client.ts since the Xtimator contract is not finalized."

patterns-established:
  - "Network seam isolation: postXphereSync is the only fetch() under src/lib/xphere/."
  - "Errors carry only message + optional scrubbed numeric status — never headers/key/JWT (secret-leak guard)."

requirements-completed: [FND-06]

# Metrics
duration: 18min
completed: 2026-06-21
---

# Phase 51 Plan 01: Worker Client Seam Summary

**Env-gated `postXphereSync` network seam (native fetch + 10s AbortSignal timeout, single attempt) with typed XphereTransientError/XpherePermanentError classification, backed by @upstash/qstash@2.11.1 and an offline tsx assertion gate.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-21T08:58:00Z
- **Completed:** 2026-06-21T09:16:00Z
- **Tasks:** 4
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- Installed `@upstash/qstash@2.11.1` as the single new runtime dependency (existing deps untouched).
- Built `src/lib/xphere/client.ts` as the ONLY Xphere network seam: env-gated dark no-op, single fetch attempt, 10s timeout, Bearer + X-Org-Id + optional Idempotency-Key headers.
- Added typed `XphereTransientError` (5xx/429/network/timeout → QStash retry) and `XpherePermanentError` (4xx → DLQ) that carry only message + scrubbed numeric status.
- Documented all 8 server-only `XPHERE_*`/`QSTASH_*` env vars in `.env.example` (gitleaks-safe, never `NEXT_PUBLIC_`).
- Added `scripts/xphere-client-check.ts` + `npm run xphere:check:client` offline gate exercising the env gate, success path, and full transient/permanent classification with a stubbed fetch.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @upstash/qstash@2.11.1** - `eb3b0f3` (chore)
2. **Task 2: Typed error classes (errors.ts)** - `d73962f` (feat — TDD RED test harness + GREEN impl in one commit)
3. **Task 3: Env-gated network seam (client.ts)** - `3838190` (feat — GREEN against the existing RED harness)
4. **Task 4: Document env vars (.env.example)** - `61edf86` (chore)

_Note: the TDD RED test (`scripts/xphere-client-check.ts`) was authored before errors.ts/client.ts and committed alongside Task 2; it stayed RED until client.ts landed in Task 3 (full GREEN)._

## Files Created/Modified
- `src/lib/xphere/errors.ts` - XphereTransientError + XpherePermanentError (message + optional numeric status only).
- `src/lib/xphere/client.ts` - postXphereSync network seam + isXphereEnabled gate + PostXphereResult type.
- `scripts/xphere-client-check.ts` - Offline assertion gate (env gate, success, transient/permanent, single-attempt) with stubbed fetch.
- `package.json` - Added @upstash/qstash@2.11.1 dependency + `xphere:check:client` script.
- `package-lock.json` - Lockfile resolution for qstash + transitive deps.
- `.env.example` - New "Xphere CRM Sync (v2.4)" section with 8 server-only placeholders.

## Decisions Made
- **Sentinel over thrown error for disabled path:** `postXphereSync` returns `{ disabled: true }` (no fetch) rather than throwing, so the Plan 02 worker reads a typed result instead of catching an XphereDisabledError — disabled is a permanent no-op, never a retry.
- **Explicit kill switch in the gate:** `isXphereEnabled()` requires both creds AND `XPHERE_SYNC_ENABLED` truthy-and-not-`'false'`, so the feature can ship dark even after credentials are provisioned.
- **No test runner introduced:** RED/GREEN via the tsx assertion harness, consistent with the Phase 50 `scripts/xphere-mapping-check.ts` convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wrapped the tsx test harness in an async main()**
- **Found during:** Task 2 (TDD RED — running scripts/xphere-client-check.ts)
- **Issue:** tsx compiles scripts to CJS output, which rejects top-level `await`; the async assertion blocks (postXphereSync calls) failed to transform with "Top-level await is currently not supported with the cjs output format".
- **Fix:** Wrapped the async assertions in `async function main()` and invoked `main().catch(...)` with `process.exit(1)` on failure — preserving non-zero exit for CI use. Synchronous error-class assertions remain at top level.
- **Files modified:** scripts/xphere-client-check.ts
- **Verification:** Harness then ran RED (module not found) and later GREEN ("all assertions passed", exit 0).
- **Committed in:** d73962f (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added `npm run xphere:check:client` script**
- **Found during:** Task 3 (client.ts GREEN)
- **Issue:** The new offline gate had no npm entry point, unlike the existing `xphere:check`; without it the classification gate would not be discoverable/runnable as a CI gate.
- **Fix:** Added `"xphere:check:client": "npx tsx scripts/xphere-client-check.ts"` to package.json scripts.
- **Files modified:** package.json
- **Verification:** `npm run xphere:check:client` → "all assertions passed", exit 0.
- **Committed in:** 3838190 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both auto-fixes are test-harness/tooling mechanics that enable the planned TDD flow and offline gate. No change to production code behavior, no scope creep.

## Issues Encountered
- None beyond the tsx top-level-await transform (documented as Deviation 1).

## Known Stubs
None — `postXphereSync` is fully wired to native fetch + env; no placeholder data paths. The Xtimator `/api/v1/sync` endpoint itself ships dark behind the env gate by design (not a stub).

## User Setup Required
External services require manual configuration to leave dark mode (deferred until Xtimator's `/api/v1/sync` lands — Phase 55). The vars are documented in `.env.example`:
- `XPHERE_API_URL`, `XPHERE_API_KEY` (Xphere org key, `sync:write` scope), `XPHERE_ORG_ID` (already known)
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` (Upstash Console → QStash)
- `XPHERE_SYNC_ENABLED=true` (kill switch) + `XPHERE_WORKER_URL` (pinned public worker URL)

Until these are set, `postXphereSync` is a typed no-op — safe to deploy.

## Next Phase Readiness
- The network seam + error classes are ready for the Plan 02 worker route (`/api/internal/xphere-sync`): it imports `postXphereSync` and the two error classes to drive QStash retry (500) vs DLQ (489).
- `@upstash/qstash` `Receiver` (verify) is available for Plan 02; `Client` (publish) for Phase 52.
- No blockers introduced. Live conformance against the real endpoint remains gated on Phase 55 (external Xtimator deliverable).

## Self-Check: PASSED
- FOUND: src/lib/xphere/errors.ts
- FOUND: src/lib/xphere/client.ts
- FOUND: scripts/xphere-client-check.ts
- FOUND commit eb3b0f3 (Task 1), d73962f (Task 2), 3838190 (Task 3), 61edf86 (Task 4)
- tsc --noEmit exits 0; npm ls @upstash/qstash → 2.11.1; both offline gates pass

---
*Phase: 51-worker-client*
*Completed: 2026-06-21*
