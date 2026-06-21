# Phase 51: Worker + Client - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — specified by v2.4 SUMMARY.md + REQUIREMENTS.md FND-04/05/06)

<domain>
## Phase Boundary

The keystone transport layer: the env-gated Xphere network client and the signature-verified QStash worker route that consumes a thin `{ tenantId, reason }` message, re-reads live tenant state (fat-read), maps it via the Phase 50 pure mapper, POSTs to the shared `/api/v1/sync`, writes back CRM ids / sync metadata, and classifies the result for QStash retry vs DLQ.

NO producers in this phase (onboarding/webhook hooks are Phase 52) and NO backfill (Phase 53). The worker is buildable/testable offline; live calls stay dark behind the env gate.

Delivers FND-04 (signature verify + fat-read), FND-05 (write-back), FND-06 (idempotency + retry classification).
</domain>

<decisions>
## Implementation Decisions

### Dependency
- Install `@upstash/qstash@2.11.1` (the single new runtime dependency). No axios/ky/BullMQ/Inngest.

### Client (src/lib/xphere/client.ts)
- The ONLY network seam. `async function postXphereSync(payload): Promise<XphereSyncResponse>` using native `fetch` with `AbortSignal.timeout(10_000)`.
- Reads `XPHERE_API_URL`, `XPHERE_API_KEY`, `XPHERE_ORG_ID` from server env. Sends `Authorization: Bearer ${XPHERE_API_KEY}`. Optional `Idempotency-Key` header (`${tenantId}:${reason}`) — header name confirmed against contract later; isolate in types/client.
- Env-gated: if `XPHERE_API_URL`/`XPHERE_API_KEY` unset OR `XPHERE_SYNC_ENABLED` is falsy → throw a typed `XphereDisabledError` (or return a sentinel) so the worker treats "disabled" as a permanent no-op, not a retry.
- Error classification: throw `XphereTransientError` on 5xx/429/network/timeout; throw `XpherePermanentError` on 4xx/unknown-stage/validation. QStash owns retries, so the client makes a SINGLE attempt.

### Worker route (src/app/api/internal/xphere-sync/route.ts)
- `export const runtime = 'nodejs'` (QStash `Receiver` needs Node crypto; service-role key; fetch budget). Never Edge.
- Read the raw body ONCE via `await req.text()`. Verify QStash signature with `new Receiver({ currentSigningKey: QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: QSTASH_NEXT_SIGNING_KEY }).verify({ signature, body, url })` BEFORE any parsing/work. Verify against a PINNED public URL constant (e.g. `XPHERE_WORKER_URL` or derived from NEXT_PUBLIC_APP_URL), NOT `req.url` — the Coolify reverse proxy rewrites host/scheme. Reject unsigned/invalid → 401.
- Only after verify: `JSON.parse` the same raw string → `{ tenantId, reason }` (zod-validate).
- Fat-read live state via the service-role client: tenant + store-admin profile (+ auth email) + tenant_subscription + plan. Resolve MRR via `getTenantPlan()` and pass the resolved plan shape into the Phase 50 pure `buildSyncPayload`.
- Call `postXphereSync`. On success: persist `xphere_account_id/contact_id/opportunity_id` + `xphere_synced_at`, clear `xphere_sync_error`. On failure: persist `xphere_sync_error` (scrubbed, no secrets).
- Retry classification (FND-06): transient → return non-2xx (500) so QStash retries; permanent → return `489` with header `Upstash-NonRetryable-Error: true` so QStash routes to DLQ instead of retrying forever. Disabled/no-op or missing tenant that is genuinely gone → 2xx (no retry).
- Idempotency (FND-06): the upsert-by-`external_id` at the endpoint is authoritative; thin-message + fat-read makes redelivery/out-of-order self-correct. Add a queue helper later (Phase 52) that sets QStash `deduplicationId`.

### Offline testability
- Add an offline check (extend the `scripts/` tsx convention) that exercises the retry-classification logic and the fat-read→map wiring with a stubbed client/fetch — no real QStash/Xphere creds. Real signature/endpoint conformance is Phase 55.

### Env documentation
- Add to `.env.example`: `XPHERE_API_URL`, `XPHERE_API_KEY`, `XPHERE_ORG_ID`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `XPHERE_SYNC_ENABLED`, `XPHERE_WORKER_URL` — all server-only, placeholders only (gitleaks-safe), never `NEXT_PUBLIC_`.

### Middleware
- The worker route `/api/internal/xphere-sync` must be reachable by an UNAUTHENTICATED QStash POST (auth = signature). Ensure middleware/reserved-path config does not gate it behind a session/tenant resolver.

### Claude's Discretion
- Exact `/api/v1/sync` field names + `Idempotency-Key` header name (contract not finalized) — keep isolated in `types.ts`/`client.ts`.
- Whether the pinned worker URL comes from a new `XPHERE_WORKER_URL` env or is derived from the existing app-URL env.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/xphere/{types,mapping}.ts` (Phase 50) — contract, SyncReason, XPHERE_STAGES, pure `buildSyncPayload`, `normalizeMrr`.
- `src/lib/tenant-plan.ts` — `getTenantPlan()` for override/grandfathered MRR resolution (called in the worker, NOT the mapper).
- `src/lib/supabase/` — service-role client factory (used by the existing Stripe webhook). Worker reuses this pattern.
- `src/app/api/stripe/webhooks/route.ts` — reference for: `runtime`, raw-body signature verify-first, service-role reads, idempotency-after-success, 200-vs-500 retry contract. Mirror this discipline.
- `src/lib/observability.ts` — error capture (scrub secrets from `xphere_sync_error`).
- `src/lib/rate-limit.ts` — existing Upstash env-gate fail-open pattern to mirror for the env gate.

### Established Patterns
- `src/lib/{domain}/` modules, no barrel. API routes under `src/app/api/`. Code in English.

### Integration Points
- New route `src/app/api/internal/xphere-sync/route.ts`. Possibly `middleware.ts` reserved-paths for the unauthenticated worker POST.
</code_context>

<specifics>
## Specific Ideas

Mirror the proven Stripe webhook discipline exactly (verify-first, service-role fat-read, record success only after business logic succeeds, else non-2xx to retry). Worker is a single Xphere attempt; QStash owns backoff/DLQ. Ship dark behind env gate. Do NOT modify the Xphere repo.
</specifics>

<deferred>
## Deferred Ideas

Producer hooks + queue.ts with deduplicationId (Phase 52), backfill (Phase 53), observability UI + reachability ping (Phase 54), live conformance test (Phase 55).
</deferred>
