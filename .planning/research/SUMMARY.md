# Project Research Summary

**Project:** XmartMenu — v2.4 Xphere CRM Sync
**Domain:** Outbound product→CRM lifecycle sync (one-way) via durable message queue (Next.js 16 App Router → Upstash QStash → shared external `POST /api/v1/sync`)
**Researched:** 2026-06-20
**Confidence:** HIGH

## Executive Summary

This milestone mirrors every XmartMenu tenant into a single shared Xphere CRM org as an Account + Contact + Opportunity, driven by lifecycle events (onboarding, plan activated, plan changed, past_due, churn, Stripe Connect). It is strictly **one-way outbound** — the XmartMenu DB stays source of truth, the CRM is a downstream mirror. All four researchers converged on the same shape established tools (HubSpot, Salesforce) use for product→CRM lifecycle sync: **event-driven (not calendar-driven), CRM-as-mirror, idempotent upsert on a stable external id, live webhooks plus a triggered backfill to hydrate history.** The object model, transport (QStash), the destination contract (`POST /api/v1/sync`), and the idempotency key (`external_id = tenants.id`) are already **decided** and are not re-litigated.

The recommended approach is a **producer → durable queue → signed worker → external API → write-back** pipeline. Producers are **enqueue-only and fire-and-forget**: every lifecycle hook calls one choke-point function `enqueueXphereSync(tenantId, reason)` that publishes to QStash and **swallows its own errors** — the single most important safeguard, because the Xphere endpoint is built by a separate (Xtimator) effort and may not exist yet, and a CRM outage must never break onboarding or a Stripe webhook 200. The QStash message is **thin** (`{ tenantId, reason }`); the worker re-reads live tenant + profile + subscription via the service-role client, maps via a pure function, POSTs, and writes the returned CRM ids back. Thin-message + fresh-read makes every retry idempotent and stale-proof. Exactly one new dependency is added: `@upstash/qstash`; everything else (zod, Sentry, Redis, native fetch) is already in the project.

The dominant risks are all consequences of async, retried, fan-in delivery and are well understood: out-of-order/stale events, idempotency keyed on a mutable field (email/phone) instead of `external_id`, double-processing (webhook + backfill racing), signature-verification footguns (raw body, both signing keys, URL claim), poison-message retry storms, backfill rate-limit storms, and PII/opt-out leakage. Mitigation mirrors the **existing Stripe webhook discipline** already proven in the repo: raw-body signature verification before any work, idempotency/state recorded only after success, transient failures → 500 (QStash retries) vs permanent failures → HTTP 489 + `Upstash-NonRetryable-Error: true` (straight to DLQ). The whole feature is buildable and unit-testable offline against the documented contract behind an env-presence gate that fails open like `rate-limit.ts`, so it ships before Xphere credentials are live with zero code change to activate.

## Key Findings

### Recommended Stack

The transport (Upstash QStash) and destination (`POST /api/v1/sync`) are decided; STACK.md scopes the SDK, env vars, verification flow, and deployment implication. Only **one new runtime dependency** is introduced — `@upstash/qstash@2.11.1` — exposing both the `Client` (publish) and `Receiver` (verify) on the same Upstash account already used for Redis/ratelimit. No new HTTP-client library: native `fetch` + `AbortSignal.timeout()` handles the worker→Xphere call. Confidence HIGH (versions verified against npm; APIs verified against official Upstash docs as of 2026-06-20).

**Core technologies:**
- `@upstash/qstash@2.11.1` — durable queue publish + signed-delivery verification — the ONLY new install; single official SDK, same vendor as existing Upstash usage, HTTP-based (works in serverless and standalone container).
- Native `fetch` (Node 24 / undici) — worker→Xphere REST call — already the project convention; `AbortSignal.timeout(10s)` gives per-request timeout with zero deps. QStash owns retries, so the call is a single attempt.
- `zod` / `@sentry/nextjs` / `@upstash/redis` — payload validation / observability / optional idempotency ledger — all already installed, reuse only, no new install.

**New env vars (all server-only, never `NEXT_PUBLIC_`):** `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `XPHERE_API_URL`, `XPHERE_API_KEY`, `XPHERE_ORG_ID` (org `e375f031-…`). Gate publishing/calls on env presence so the app degrades gracefully (skip-and-log) — the **fail-open pattern from `src/lib/rate-limit.ts`**.

### Expected Features

FEATURES.md defines behavior (lifecycle event → CRM effect), grouped table-stakes / differentiator / anti-feature. Every sync upserts Account + Contact first (re-asserting identity from current DB), then moves the Opportunity stage — so a missed earlier event self-heals on the next one.

**Must have (table stakes):**
- Transport spine — `src/lib/xphere/` (client + mapping + types + queue) + QStash producer + signature-verified idempotent worker `/api/internal/xphere-sync`.
- `tenants` migration — `xphere_account_id`, `xphere_contact_id`, `xphere_opportunity_id`, `xphere_synced_at`, `xphere_sync_error`.
- Lifecycle syncs: onboarding (#1 → Onboarding stage), plan activated (#2 → Active/Won + MRR), past_due (#4 → At Risk), churn (#5 → Lost/Churned).
- Idempotent upsert by `external_id = tenants.id`; async/non-blocking delivery; QStash retry with backoff.
- One-time superadmin backfill (idempotent, re-runnable); `xphere_sync_error` surfaced in superadmin + manual single-tenant re-sync.

**Should have (competitive, P2):**
- Plan upgrade/downgrade direction tags (#3); Stripe Connect connected flag (#6); MRR snapshot via `getTenantPlan()` (applies grandfathered overrides — never read raw `plans.monthly_price`); backfill dry-run/report mode; superadmin sync-health dashboard (synced/errored/never-synced counts).

**Defer (v2+ / P3):**
- First paid order activation signal (#7, needs first-order detection); richer/templated timeline notes.

**Anti-features (DO NOT BUILD):** two-way/bidirectional sync; per-tenant CRM orgs; synchronous/inline sync in the webhook; per-order revenue lines; modifying the Xphere repo; caching CRM data back in XmartMenu; custom retry/queue implementation; per-staff-member Contacts (Contact = store-admin owner only).

### Architecture Approach

ARCHITECTURE.md wires the feature in as a producer to durable queue to consumer to external API to write-back pipeline, mirroring the repo existing src/lib/{domain}/ convention and the Stripe webhook machine-to-machine trust model. Mapping is a pure function (offline unit-testable against the documented contract); the worker route forces the nodejs runtime and reads the raw body for verification.

**Major components:**
1. enqueueXphereSync() (src/lib/xphere/queue.ts) — single choke-point producer; publishJSON wrapped in try/catch, returns void, NEVER throws into the caller (fail-open like rate-limit.ts).
2. Worker /api/internal/xphere-sync — Receiver.verify(signature, rawBody), createServiceClient() loads live tenant+profile+subscription, buildXpherePayload() (pure), syncToXphere() POST, then write back xphere_*_id / xphere_synced_at / xphere_sync_error.
3. xphere/types.ts + mapping.ts + client.ts — typed contract, pure mapping, the only network-touching file; absorbs contract drift in one place.
4. Producer hooks (MODIFIED) — onboarding, three Stripe webhook branches, Connect callback; enqueue AFTER the DB write succeeds, never before the idempotency record, never inline.
5. Superadmin backfill /api/superadmin/xphere/backfill — assertSuperadmin() + paginated enqueue loop reusing the exact same worker path (one code path equals one set of guarantees).
6. tenants.xphere_* columns (migration 054_xphere_sync_columns.sql) — persisted CRM linkage + last sync status/error.

### Critical Pitfalls

1. **Out-of-order / stale events** (QStash gives no ordering guarantee, at-least-once) — worker reads live state at process time (thin message {tenantId, reason}, fat read) + full upsert by external_id; a late retry re-sends current truth. Never write a status derived from an event older than xphere_synced_at.
2. **Idempotency keyed on email/phone instead of external_id** — would merge/split tenants (chain owners share emails). Match key is the immutable external_id = tenants.id only; email/phone are attributes, never lookup keys. Persist returned CRM ids to detect drift.
3. **QStash signature footguns** — verify against the raw body read once with req.text() (never JSON.parse then re-stringify); supply BOTH current + next signing keys (rotation-safe); match the exact public URL claim; reject unsigned with 401. Mirrors the Stripe constructEvent discipline.
4. **Coupling to the unbuilt /api/v1/sync** — producers ENQUEUE-ONLY and return immediately; build against a typed contract stub + XPHERE_API_URL; env-presence gate + optional XPHERE_SYNC_ENABLED kill switch. A dead/absent endpoint must never 500 onboarding or the Stripe webhook.
5. **Poison-message retry storms & backfill rate-limit storms** — distinguish transient (5xx/network/429 to 500, QStash retries) vs permanent (4xx/validation/unknown-stage/tenant-not-found to 489 + Upstash-NonRetryable-Error: true to DLQ); honor Retry-After on 429; throttle backfill via QStash flow-control/staggered delay; cap Upstash-Retries; monitor DLQ.

Additional flagged pitfalls: partial multi-call failure (checkpoint ids per step, re-runnable) — *confirm the contract guarantees atomic Account+Contact+Opportunity upsert*; missing pipeline-stage names (data-only config in the Xphere org, central stage constants + preflight assertion); secret leaks (gitleaks CI gate, no literal-fallback secrets, scrub keys from xphere_sync_error); PII/opt-out (filter internal/test tenants, respect a marketing-consent flag, always tag source=xmartmenu).

## Implications for Roadmap

All four researchers independently produced the **same dependency-respecting build order**. The roadmapper should treat this as the phase skeleton. Phases 1-5 are fully buildable and exercisable OFFLINE against the documented contract (XPHERE_* unset, client throws not-configured, error recorded, or pointed at a local stub); the live integration test is deferred until Xtimator ships /api/v1/sync and credentials land — the env-presence gate activates real calls with zero code change.

### Phase 1: Schema & Contract Foundation
**Rationale:** Everything below reads/writes the xphere_* columns and depends on the typed contract; no dependencies of its own.
**Delivers:** Migration 054_xphere_sync_columns.sql (xphere_account_id/contact_id/opportunity_id/synced_at/sync_error) + interface Tenant update; src/lib/xphere/types.ts (contract + SyncReason) and mapping.ts (pure, unit-tested against the documented contract); central pipeline-stage constants.
**Addresses:** tenants migration + idempotent-upsert mapping (table stakes).
**Avoids:** Pitfall 2 (mapper hard-codes external_id, never email/phone), Pitfall 6 (stage constants), Pitfall 5 (contract atomicity clarified here).

### Phase 2: Worker
**Rationale:** Depends on the lib + migration; testable end-to-end against a local Xphere stub. The retry/error contract is the keystone everything else relies on.
**Delivers:** /api/internal/xphere-sync/route.ts — nodejs runtime, raw-body Receiver.verify (both signing keys, URL claim), live service-role read, pure map, env-gated client.ts POST, write-back; transient-to-500 / permanent-to-489-DLQ classification; error capture to xphere_sync_error + Sentry.
**Uses:** @upstash/qstash Receiver, native fetch + AbortSignal.timeout, createServiceClient().
**Implements:** Worker + client.ts. **Avoids:** Pitfalls 1, 3, 4 (worker side), 5, 9 (429-aware), 10.

### Phase 3: Enqueue / Lifecycle Hooks
**Rationale:** Hooks need the producer + worker to exist so enqueued jobs land somewhere. This is where the never-break-core-flows guarantee is enforced.
**Delivers:** src/lib/xphere/queue.ts (enqueueXphereSync, fail-open, swallows errors) + wiring into onboarding (after subscription insert), the three Stripe webhook branches (after the DB write, inside the success path, after the idempotency record), and the Connect callback. Producer-side filtering of internal/test/opt-out tenants; always send source=xmartmenu.
**Addresses:** Onboarding (#1), plan activated (#2), past_due (#4), churn (#5); Connect (#6) and upgrade/downgrade (#3) tags are cheap to include here or defer to P2.
**Avoids:** Pitfall 7 (enqueue-only, never inline), Pitfall 11 (producer filters + source/consent).

### Phase 4: Backfill
**Rationale:** Reuses the producer + worker; populates history for existing tenants.
**Delivers:** /api/superadmin/xphere/backfill — assertSuperadmin() + paginated, throttled enqueue loop through the SAME worker path; idempotent, re-runnable.
**Avoids:** Pitfall 3 (one code path, upsert convergence) + Pitfall 9 (throttle/flow-control so backfill stays under the /api/v1/sync rate limit).

### Phase 5: Observability & Ops
**Rationale:** Depends on data the worker writes.
**Delivers:** Surface xphere_sync_error / xphere_synced_at in superadmin tenant detail + sync-health dashboard; manual single-tenant re-sync button (re-enqueue); DLQ monitoring; gitleaks CI gate + log scrubbing; optional XPHERE_SYNC_ENABLED kill switch.
**Avoids:** Pitfall 8 (secret leaks), Pitfall 10/storm visibility, UX pitfalls (silent failures).

### Phase 6 (deferred): Live Integration Test
**Rationale:** Only runnable once Xtimator ships /api/v1/sync and real credentials land. The env-presence gate activates real calls with no code change; run the Looks-Done-But-Isnt checklist (idempotency, out-of-order, stale retry, signature, partial failure, missing stage, backfill+live race, endpoint-down, secrets, opt-out, observability).

### Phase Ordering Rationale
- **Dependency-forced:** migration types to lib (types to mapping to client to queue) to worker to hooks to backfill to observability. Each layer reads/writes what the layer below it created; this is the consensus order across STACK, FEATURES, and ARCHITECTURE.
- **Decoupling-driven:** the unbuilt Xphere endpoint forces depend-on-the-interface-not-the-implementation — the pure mapping (the most bug-prone part) is testable offline, so Phases 1-5 proceed in parallel with the Xtimator effort.
- **Risk-front-loaded:** the idempotency key (P1), the signature + retry contract (P2), and enqueue-only producers (P3) — the three things that, if wrong, cause cross-tenant corruption, an open CRM-write endpoint, or broken onboarding — are built earliest.

### Research Flags

Phases likely needing deeper research / contract confirmation during planning:
- **Phase 1-2:** The exact /api/v1/sync request/response contract must be pinned before mapping/worker are finalized — specifically whether one call upserts Account+Contact+Opportunity atomically (Pitfall 5 determines whether multi-call checkpointing is needed) and the exact Idempotency-Key header name.
- **Phase 3:** Whether a tenant marketing-consent / opt-out field exists in the schema (Pitfall 11). If absent, flag to product before syncing PII. Also: the internal/test-tenant filter flag — how to identify and exclude demo/internal tenants at the producer.
- **Phase 2 / deployment:** Confirm the live deploy target (Vercel vs Coolify standalone container at xmartmenu.skale.club) — the repo state (Dockerfile, docker-compose for Coolify GHCR, CI commits) contradicts the documented Vercel. This decides the public callback URL and that no auth wall sits in front of the worker (security equals signature verification, not network restriction).

Phases with standard, well-documented patterns (lighter research):
- **Phase 4 Backfill** — standard idempotent fan-out reusing the worker path.
- **Phase 5 Observability** — reuses existing superadmin patterns + captureSecurityEvent + gitleaks.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified from npm registry; QStash Client/Receiver/retry/dedup APIs verified against official Upstash docs (2026-06-20). One new dep, no native build step. |
| Features | HIGH | Lifecycle/stage mapping equals standard HubSpot/Salesforce pattern + verified against the existing Stripe webhook branches in-repo; mapping already decided. Observability UI surface MEDIUM-HIGH (depends on existing admin patterns). |
| Architecture | HIGH | Codebase verified directly; pipeline shape mirrors proven repo conventions (src/lib/{domain}/, Stripe webhook trust model, rate-limit.ts fail-open, Realtime re-fetch-on-event). |
| Pitfalls | HIGH | Each pitfall mapped to the existing Stripe webhook discipline + official QStash retry/signature docs; phase mapping + verification checklist provided. |

**Overall confidence:** HIGH

### Gaps to Address

- **Exact /api/v1/sync contract** (request/response shape, atomicity, idempotency-key header name): code against the documented contract via a typed stub + XPHERE_API_URL; pin a contract version; treat a shape mismatch as a recordable xphere_sync_error, not a crash. Resolve before finalizing Phases 1-2.
- **Live deployment target (Vercel vs Coolify container):** confirm before building so the public callback URL and the no-blocking-auth-in-front-of-the-worker requirement are correct. SDK code is identical either way.
- **Marketing-consent / opt-out field:** confirm whether the column exists. If yes, include it in mapping + suppress PII for opted-out tenants; if no, flag to product before syncing PII (GDPR/LGPD).
- **Internal/test-tenant filter flag:** define how internal/demo/test tenants are identified so the producer can exclude them from the CRM.
- **No test runner yet:** the repo has no test harness. The pure mapping.ts is the highest-value unit-test target and the Looks-Done-But-Isnt checklist needs a home — decide the test approach (add a runner, or scripted verification) during planning.

## Sources

### Primary (HIGH confidence)
- npm registry @upstash/qstash — latest 2.11.1 (2026-06-16); transitive jose@5, crypto-js, neverthrow@7.
- Upstash QStash docs — signature verification (Receiver / verifySignatureAppRouter, raw-body, current+next keys, URL claim), retries (exponential backoff to 24h, Upstash-Retries, Retry-After, 489 + Upstash-NonRetryable-Error), deduplication (10-min window), callbacks/DLQ.
- @upstash/qstash SDK README — Client.publishJSON, Receiver.verify.
- XmartMenu codebase (verified directly): src/app/api/stripe/webhooks/route.ts, src/app/api/onboarding/route.ts, src/app/api/stripe/connect/callback/route.ts, src/lib/rate-limit.ts, src/lib/supabase/server.ts, src/lib/observability.ts, src/lib/superadmin-auth.ts, src/lib/tenant-plan.ts, src/types/database.ts, supabase/migrations/*, package.json.
- .planning/PROJECT.md (v2.4 milestone scope + locked decisions) and .planning/codebase/CONCERNS.md (hardcoded-fallback secret pattern, CI gaps).
- Repo deployment evidence (Dockerfile, docker-compose.yaml Coolify/GHCR, recent CI commits) vs documented Vercel — discrepancy flagged.

### Secondary (MEDIUM confidence)
- Salesforce Data 360 integration patterns — upsert by ExternalId, self-healing replays, webhook-live + scheduled-backfill.
- HubSpot lifecycle-stage sync — event-driven stage model (Onboarding/Active/At-Risk/Churned).
- Idempotent pipeline / backfilling literature (ml4devs, dataskew.io 2026) — re-runnable MERGE/UPSERT by business key, DLQ patterns.
- SaaS CRM onboarding playbooks (digitalapplied.com, ustechautomations.com 2026) — event-driven over calendar-driven consensus.

---
*Research completed: 2026-06-20*
*Ready for roadmap: yes*
