---
phase: 52-producer-hooks
plan: 04
subsystem: integrations
tags: [xphere, crm, qstash, producer, fail-open, gate, offline-test, fnd-03]

# Dependency graph
requires:
  - phase: 52-producer-hooks
    provides: enqueueXphereSync fail-open producer (src/lib/xphere/queue.ts, plan 52-01)
  - phase: 51-xphere-foundation
    provides: SyncReason union (src/lib/xphere/types.ts)
provides:
  - Offline runnable gate (npm run xphere:check:queue) locking the FND-03 producer invariants
  - Proof that enqueueXphereSync is fail-open, builds the thin message, and no-ops when env unset
affects: [53-backfill, 54-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Offline tsx assertion gate (node:assert/strict, no test runner) mirroring scripts/xphere-client-check.ts and scripts/xphere-worker-check.ts"
    - "Dynamic import of queue.ts AFTER setting dummy QSTASH_TOKEN/XPHERE_WORKER_URL in-process, because queue.ts builds its QStash client at module load"
    - "Stub globalThis.fetch at the QStash SDK network seam to intercept publishJSON with no real credentials"

key-files:
  created:
    - scripts/xphere-queue-check.ts
  modified:
    - package.json

key-decisions:
  - "Asserted deduplicationId and retries against the actual request HEADERS (Upstash-Deduplication-Id, Upstash-Retries) — the QStash SDK carries them as headers, not in the JSON body, which holds exactly the thin { tenantId, reason, eventId?, tags? } payload. Verified by inspecting node_modules/@upstash/qstash/index.js (processHeaders)."
  - "A 200 JSON fetch stub resolves on the SDK's first attempt (requestWithBackoff breaks the loop on a successful fetch), so the success path asserts exactly one fetch call with no real retry loop."
  - "no-op branch tested via the URL gate (delete XPHERE_WORKER_URL + NEXT_PUBLIC_APP_URL) rather than QSTASH_TOKEN, since the module-level client is already built at import; the token-unset half of the guard is exercised at module load (client = token ? new Client : null) and documented in a comment."
  - "Added a 4th assertion block (beyond the plan's 3) proving optional fields are omitted entirely when absent — guards the spread-only-when-present logic that keeps the worker's optional zod fields truly optional."

patterns-established:
  - "Producer gates assert wire-shape against where the SDK actually places fields (body vs headers), verified against the installed SDK source, not assumed."

requirements-completed: [FND-03]

# Metrics
duration: 6min
completed: 2026-06-21
---

# Phase 52 Plan 04: Producer Fail-Open Gate Summary

An offline `tsx` gate (`scripts/xphere-queue-check.ts` + `npm run xphere:check:queue`) that proves the FND-03 producer invariants for `enqueueXphereSync` with no real QStash/Xphere credentials and no real network — fail-open on a thrown publish, correct thin message shape with `deduplicationId: xphere:<tenantId>:<reason>` and `retries: 5`, and a silent zero-fetch no-op when no destination URL resolves.

## What Was Built

`scripts/xphere-queue-check.ts` mirrors the existing `scripts/xphere-client-check.ts` convention exactly: `node:assert/strict`, a `stubFetch` helper that replaces `globalThis.fetch` and records calls, a `main().catch(err => { console.error(err); process.exit(1) })` wrapper that yields a non-zero exit on any failed assertion, fetch restored at the end, and a final `console.log('xphere-queue-check: all assertions passed')`.

Because `src/lib/xphere/queue.ts` reads `QSTASH_TOKEN` at module load to construct its QStash client, the script sets dummy `QSTASH_TOKEN` + `XPHERE_WORKER_URL` in-process and then **dynamically imports** `queue.ts` inside `main()`, so the client is built with the dummy token. The QStash SDK publishes via `fetch`, so the fetch stub intercepts the publish at the network seam.

Assertions:
1. **Success path / message shape** — one fetch call; JSON body deep-equals `{ tenantId: 'tenant-uuid-1', reason: 'plan_changed', eventId: 'evt_123', tags: ['upgrade'] }`; `Upstash-Deduplication-Id` header === `xphere:tenant-uuid-1:plan_changed`; `Upstash-Retries` header === `5`.
2. **Optional fields omitted** — `enqueueXphereSync('tenant-uuid-2', 'onboarded')` body deep-equals `{ tenantId, reason }` only (no `eventId`/`tags` keys).
3. **Fail-open** — a fetch stub that throws is swallowed; the call resolves, never rejects (the core FND-03 invariant).
4. **Silent no-op** — with `XPHERE_WORKER_URL`/`NEXT_PUBLIC_APP_URL` unset, zero fetch calls and no throw.

`package.json` registers `"xphere:check:queue": "npx tsx scripts/xphere-queue-check.ts"` next to the sibling xphere gates.

## How It Works

The load-bearing detail discovered from the installed SDK (`node_modules/@upstash/qstash/index.js`): `publishJSON` serializes only the thin payload into the request body, while `deduplicationId` and `retries` are emitted as the `Upstash-Deduplication-Id` and `Upstash-Retries` request headers (via `processHeaders`). The gate therefore asserts those values off the recorded request headers (with a `header()` helper that handles `Headers`, array, or plain-object header shapes), not the JSON body. A 200 stub response resolves on the SDK's first attempt, so the success path observes exactly one fetch call.

## Deviations from Plan

None requiring intervention. The plan's Task 1 explicitly anticipated that `deduplicationId`/`retries` might land in headers vs body and instructed asserting "against the real shape" — confirmed via SDK source and implemented accordingly. One additional assertion block (optional-fields-omitted) was added beyond the plan's three to cover the spread-only-when-present logic; this strengthens the gate without changing scope.

## Verification

- `npm run xphere:check:queue` exits 0 and prints `xphere-queue-check: all assertions passed` (the `xphere.enqueue_failed` log line in the output is the expected observe-and-swallow path proving fail-open).
- `npx tsc --noEmit` exits 0.
- No real QStash/Xphere credentials used — dummy in-process env only.

## Known Stubs

None. The stubbed `fetch` is the intended test seam (the gate is an offline assertion script, not shipped product code); no UI-facing placeholder data was introduced.

## Self-Check: PASSED

- FOUND: scripts/xphere-queue-check.ts
- FOUND: package.json (xphere:check:queue script)
- FOUND: commit 318d95b
