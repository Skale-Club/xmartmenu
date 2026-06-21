---
phase: 51-worker-client
plan: 02
subsystem: integrations
tags: [xphere, qstash, crm, webhook, signature-verification, zod, supabase, nodejs-runtime, typescript]

# Dependency graph
requires:
  - phase: 50-schema-contract
    provides: "src/lib/xphere/types.ts + mapping.ts — XphereSyncRequest, SyncReason, buildSyncPayload"
  - phase: 51-worker-client (plan 01)
    provides: "postXphereSync network seam + XphereTransientError/XpherePermanentError; @upstash/qstash Receiver"
provides:
  - "POST /api/internal/xphere-sync — signature-verified QStash worker (Node runtime): verify-first, fat-read, map, POST seam, write-back, retry classification"
  - "Middleware /api/internal/* early passthrough so the unauthenticated QStash POST is never session/tenant-gated"
  - "FND-04 signature gate (current+next keys, pinned URL, raw body once, 401 on invalid)"
  - "FND-05 success write-back (xphere_*_id + xphere_synced_at, clears xphere_sync_error) / scrubbed-error on failure"
  - "FND-06 retry classification (transient 500, permanent 489+Upstash-NonRetryable-Error, disabled/gone 2xx)"
affects: [52-producer-hooks, 53-backfill, 54-observability, 55-live-conformance, qstash-publish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verify-first on raw body (mirrors Stripe webhook discipline) before any parse/DB read"
    - "Pinned-public-URL signature verification (not req.url) for Coolify reverse-proxy correctness"
    - "Thin-message + service-role fat-read: worker re-derives canonical state at process time"
    - "Record success only after business logic; fail-closed error persistence without advancing the watermark"
    - "Queue retry classification at the HTTP layer: 401 / 200 / 489+non-retryable / 500"
    - "Middleware early-return passthrough for signature-authed internal routes"

key-files:
  created:
    - "src/app/api/internal/xphere-sync/route.ts"
  modified:
    - "src/middleware.ts"

key-decisions:
  - "Bad/malformed payload (JSON.parse failure or zod failure) is permanent → 489 + Upstash-NonRetryable-Error, not 400 — retrying an unparseable message is pure waste and belongs in the DLQ."
  - "No subscription (getTenantPlan → null) is permanent (489 DLQ): there is no deal to sync, so retrying cannot succeed."
  - "Genuinely-missing tenant returns 200 (no retry) — a deleted tenant is not a transient failure."
  - "Verify against a pinned XPHERE_WORKER_URL / NEXT_PUBLIC_APP_URL constant, never req.url, so Coolify's proxy host rewrite cannot break verification in prod (Pitfall 10)."

patterns-established:
  - "Internal signature-authed routes pass through middleware untouched (auth = signature, not network/session)."
  - "Worker write-back: xphere_synced_at only ever advances past a SUCCESSFUL postXphereSync; failures persist a scrubbed xphere_sync_error and leave the watermark."

requirements-completed: [FND-04, FND-05, FND-06]

# Metrics
duration: 3min
completed: 2026-06-21
---

# Phase 51 Plan 02: QStash Xphere Sync Worker Summary

**Signature-verified `POST /api/internal/xphere-sync` (Node runtime) that verifies the QStash signature on the raw body against current+next keys and a pinned public URL before any work, service-role fat-reads tenant + store-admin owner + currency + plan, maps via `buildSyncPayload`, calls the `postXphereSync` seam, writes back CRM ids + `xphere_synced_at` on success, and classifies failures into 401 / 200 / 489+non-retryable / 500 — plus a middleware passthrough so the unauthenticated QStash POST reaches it.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-21T09:15:44Z
- **Completed:** 2026-06-21T09:18:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Added an early `/api/internal/*` passthrough at the very top of `middleware()` — before the tenant-slug block, custom-domain host rewrite, and `updateSession()`/`getUser()` — so the unauthenticated QStash POST authenticates by signature alone.
- Built the keystone worker route `src/app/api/internal/xphere-sync/route.ts` on the Node runtime: raw body read once, QStash signature verified (both signing keys, pinned URL) BEFORE any parse/DB read, zod-validated thin message, service-role fat-read, pure map, single network seam, success write-back, and full transient/permanent/no-op retry classification.
- Wired the three Phase 51-01/Phase 50 contracts end-to-end: `postXphereSync` (only network seam), `XpherePermanentError` (DLQ classification), `buildSyncPayload` + `getTenantPlan` (fat-read + pure map).

## Task Commits

Each task was committed atomically:

1. **Task 1: Middleware passthrough for /api/internal/** - `1899ce1` (feat)
2. **Task 2: Worker route — verify-first + fat-read + map + write-back + retry classification** - `9b70e92` (feat)

## Files Created/Modified
- `src/app/api/internal/xphere-sync/route.ts` - The signature-verified QStash worker: `runtime='nodejs'`, raw-body verify-first against a pinned URL with both keys (401 on fail), zod-parse, service-role fat-read of tenant + store-admin owner + tenant_settings currency + `getTenantPlan()`, `buildSyncPayload()`, `postXphereSync()`, success write-back of all five `xphere_*` columns, scrubbed-error-on-failure, retry classification (500/489/200).
- `src/middleware.ts` - Early `NextResponse.next()` for `/api/internal/*` before any tenant-slug / host-rewrite / session logic.

## Decisions Made
- **Malformed payload → 489 (DLQ), not 400:** a message that fails `JSON.parse` or zod validation can never succeed on retry, so it goes straight to the DLQ via `Upstash-NonRetryable-Error: true` rather than a retryable status.
- **No subscription → 489 (permanent):** `getTenantPlan() === null` means there is no deal to sync; retrying is wasted, so it dead-letters.
- **Missing tenant → 200 (no retry):** a genuinely deleted tenant is a permanent no-op, not a transient failure.
- **Pinned-URL verify:** the signature is checked against `XPHERE_WORKER_URL ?? `${NEXT_PUBLIC_APP_URL}/api/internal/xphere-sync``, never `req.url`, so Coolify's reverse-proxy host rewrite cannot break verification in production (Pitfall 10).
- **Idempotency key `${tenantId}:${reason}`** passed to `postXphereSync`; no local dedup ledger (the QStash `deduplicationId` is the Phase 52 producer's responsibility, and the Xphere upsert-by-`external_id` is authoritative).

## Deviations from Plan

None - plan executed exactly as written. The `XphereTransientError` import named in the plan's import list was omitted because the catch block treats transient-or-any-unexpected-throw identically (the only explicit class check is `XpherePermanentError`); importing an unused symbol would fail `noUnusedLocals`. This is a faithful implementation of the documented classification, not a behavior change.

## Issues Encountered
- None. `npx tsc --noEmit` exited 0 after each task.

## Known Stubs
None. The route is fully wired: signature verification, fat-read, mapping, and the network seam all use real implementations. When the env gate is closed, `postXphereSync` returns `{ disabled: true }` and the worker returns a 200 no-op by design (dark mode, not a stub).

## User Setup Required
None new beyond Plan 01's documented `XPHERE_*` / `QSTASH_*` env vars. This worker additionally consumes `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` (signature verification), and `XPHERE_WORKER_URL` / `NEXT_PUBLIC_APP_URL` (pinned verify URL) — all already documented in `.env.example` from Plan 01. The worker path must be publicly routable (Coolify domain + TLS) for QStash to deliver (Pitfall 10 — addressed operationally in Phase 54/55).

## Next Phase Readiness
- The verified transport is live: Phase 52 producers can now `Client.publish(...)` thin `{ tenantId, reason }` messages to this worker and rely on at-least-once delivery + the worker's idempotent fat-read.
- The retry contract (500 retry / 489 DLQ / 200 no-op) is in place for observability (Phase 54) and live conformance (Phase 55) to exercise.
- No blockers introduced. Live delivery stays gated on the env vars + public reachability, which are external/ops concerns.

## Self-Check: PASSED
- FOUND: src/app/api/internal/xphere-sync/route.ts
- FOUND: src/middleware.ts (/api/internal passthrough)
- FOUND commit 1899ce1 (Task 1), 9b70e92 (Task 2)
- npx tsc --noEmit exits 0; no direct fetch in src/app/api/internal/; verify uses workerUrl not req.url

---
*Phase: 51-worker-client*
*Completed: 2026-06-21*
