# Project Research Summary

**Project:** XmartMenu — v2.4 CRM & Integrations (Xphere CRM Sync)
**Domain:** Outbound, one-way product→CRM lifecycle sync (Next.js 16 App Router + Supabase → Upstash QStash → shared external `POST /api/v1/sync`)
**Researched:** 2026-06-21
**Confidence:** HIGH

## Executive Summary

This milestone mirrors every XmartMenu tenant into a dedicated Xphere CRM org as an **Account + Contact + Opportunity**, keeping the CRM in step with the full subscription lifecycle. The transport, object model, and idempotency key are already **decided**: producers enqueue a thin message to **Upstash QStash**, a signature-verified worker route re-reads live state and calls the shared `POST /api/v1/sync` endpoint, and every object upserts on `external_id = tenants.id` (immutable). Mapping is `tenants` row → **Account**, store-admin owner `profiles` row → **Contact** (owner only, never staff), and `tenant_subscriptions` → **Opportunity** whose stage tracks the lifecycle (Onboarding → Active[Won] → At Risk[open] → Churned[Lost]) and whose value is **MRR** resolved via `getTenantPlan()` (applies grandfathered overrides) and normalized annual→monthly (`annual_price / 12`). The way experts build this — verified against HubSpot/Salesforce patterns — is event-driven (not calendar-driven), CRM-as-downstream-mirror, idempotent upsert-by-stable-external-id, live webhooks plus a triggered backfill to hydrate history. That is exactly the decided shape.

The recommended approach adds **exactly one new runtime dependency** (`@upstash/qstash@2.11.1`); `zod`, `@sentry/nextjs`, `@upstash/redis`, and native `fetch` are already present. The architecture splits into a pure, offline-testable `src/lib/xphere/` module (types/mapping/client/queue), a Node-runtime worker at `/api/internal/xphere-sync`, thin enqueue-only hooks bolted into existing choke points (onboarding, three Stripe webhook branches, Connect callback), and a superadmin backfill that fans out through the same worker path. The non-negotiable safeguard is the **enqueue-only, fail-open producer**: the Stripe webhook returns HTTP 500 to force a Stripe retry on any business-logic failure, so an inline CRM call would make Stripe replay the whole event forever — producers must enqueue after the DB write succeeds and never throw.

The dominant risk is that the destination `/api/v1/sync` is **not built yet** (separate Xtimator effort, must NOT be modified) and the app is deployed on **Docker/Coolify, not Vercel** — both of which the older planning docs get wrong. This forces a contract-first build against a typed stub, an env-gated client that ships dark and activates when credentials land, and careful handling of the QStash public-URL/signature story behind the Coolify reverse proxy. The keystone correctness mechanisms are the **thin-message + fat-read** pattern (immunizes against at-least-once and out-of-order delivery) and **three-layer idempotency** (endpoint upsert + QStash dedup + optional Idempotency-Key header). Get the idempotency key, the signature/runtime, and the enqueue-only discipline right early, and the rest is mechanical.

## Key Findings

### Recommended Stack

The only new install is **`@upstash/qstash@2.11.1`** — a single official SDK exposing `Client` (publish) and `Receiver`/`verifySignatureAppRouter` (verify), same vendor as the already-installed Upstash Redis/ratelimit. It is HTTP-based (no persistent connection) so it works in both serverless and standalone-container Next.js, and pulls in `jose`/`crypto-js`/`neverthrow` transitively with no native build step. Everything else (`zod`, `@sentry/nextjs`, `@upstash/redis`, native `fetch` + `AbortSignal.timeout`) is already in the project — do NOT reinstall. The worker→Xphere call uses native `fetch`; do not add `axios`/`ky`, BullMQ, Inngest, or `@upstash/workflow`.

**Core technologies:**
- **`@upstash/qstash@2.11.1`** — durable at-least-once delivery + signed callbacks — single SDK for publish and verify, vendor-consolidated, serverless/container-compatible.
- **`zod@^4` (existing)** — runtime-validate the worker inbound body + the typed Xphere contract — already a dependency.
- **Native `fetch` (existing)** — server-to-server call to `XPHERE_API_URL` with `AbortSignal.timeout(10s)` — project HTTP convention, QStash owns retries so the worker→Xphere call is a single attempt.

**Required env vars (all server-only — never `NEXT_PUBLIC_`):**
- `QSTASH_TOKEN` (publisher auth), `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` (worker verify, both required for rotation-safety)
- `XPHERE_API_URL`, `XPHERE_API_KEY` (Bearer, `sync:write` scope), `XPHERE_ORG_ID` (`e375f031-4d9a-42b1-9f3c-ade805650442`)
- optional: `QSTASH_URL` (local dev server), `XPHERE_SYNC_ENABLED` (kill switch), a pinned public worker URL (e.g. `XPHERE_WORKER_URL`)

### Expected Features

**Entity mapping (decided):** `tenants` → **Account**, owner `profiles` → **Contact** (owner only), `tenant_subscriptions` → **Opportunity** (one per tenant, the subscription is the deal), all keyed `external_id = tenants.id`. Account+Contact upsert runs first on every event (self-healing) before moving the Opportunity.

**Opportunity stage model:** `Onboarding` (open; signup on entry `menu` plan, active-but-unpaid) → `Active`/**Won** (paid checkout completes) → `At Risk` (open/re-openable on `past_due` — NOT Lost, dunning often recovers) → `Churned`/**Lost** (cancel/delete). Opportunity amount = **normalized MRR** (`getTenantPlan` for overrides, then `annual_price / 12` when billing_cycle is annual, else `monthly_price` — never read raw `plans.monthly_price`). custom_fields = current-truth snapshot (overwrite each sync); timeline notes = append-only event log (deduped by event id).

**Must have (table stakes — P1):**
- Transport spine — `src/lib/xphere/` + QStash producer + signature-verified idempotent worker — nothing syncs without it.
- `tenants` migration (`xphere_account_id/contact_id/opportunity_id/synced_at/sync_error`) — sync state must be queryable.
- Event #1 Onboarding sync, #2 Plan activated (Active/Won + normalized MRR), #4 Past_due (At Risk), #5 Churn (Churned/Lost) — core lifecycle.
- One-time superadmin backfill (idempotent, re-runnable, no duplicate onboarded note).
- Async/non-blocking delivery + idempotent upsert by `external_id` — must never break onboarding or the Stripe 200/500 contract.
- Observability v1: `xphere_sync_error` surfaced in superadmin tenant detail + manual re-sync button.

**Should have (competitive — P2):**
- Event #3 plan upgrade/downgrade direction tags — MEDIUM, needs prior-`plan_id` diff before checkout overwrites it (NOT free).
- Event #6 Stripe Connect connected flag (callback + `account.updated`) — strong PQL signal.
- Backfill dry-run/report mode + superadmin sync-health dashboard.

**Defer (v2+ — P3):**
- Event #7 first paid order activation signal — needs `tenants.first_paid_order_at` first-order detection.
- Templated/richer timeline notes.

**Do NOT build (anti-features):** two-way/bidirectional sync, per-tenant CRM orgs, inline/synchronous CRM call in the webhook, per-order syncing, modifying the Xphere repo, caching CRM data back in XmartMenu, per-staff Contacts, separate Opportunity per invoice.

### Architecture Approach

New code lives in `src/lib/xphere/` (`types.ts` contract + `SyncReason` + `XPHERE_STAGES`; `mapping.ts` pure/offline-testable; `client.ts` the only network seam; `queue.ts` fail-open producer), a Node-runtime worker at `app/api/internal/xphere-sync/route.ts`, a superadmin backfill at `app/api/superadmin/xphere/backfill/route.ts`, and migration `054_xphere_sync_columns.sql`. Existing routes are MODIFIED only to add a thin enqueue call after their DB write succeeds. The worker raw-body-verifies the QStash signature, **fat-reads** live tenant+profile+subscription+plan via the service-role client, maps with the pure function, POSTs Xphere, writes back `xphere_*_id`/`xphere_synced_at`/clears `xphere_sync_error`, and classifies the result for retry.

**Major components:**
1. **`enqueueXphereSync(tenantId, reason)`** (`queue.ts`, NEW) — single fail-open choke point; publishes thin {tenantId, reason} inside try/catch, returns void, never throws into onboarding/webhook.
2. **Worker route** (`/api/internal/xphere-sync`, NEW, `runtime='nodejs'`) — verify, fat-read, pure-map, `fetch` Xphere, write-back, 2xx/500/489 retry classification.
3. **`client.ts` / `mapping.ts` / `types.ts`** (NEW) — single network seam, pure mapper (highest-value test target; repo has no test runner yet — flag), typed contract + stage constants.
4. **Producer hooks** (MODIFIED) — onboarding tenant-creation branch (after sub insert ~L198), 3 Stripe webhook success branches (after idempotency row, before final return), Connect callback (after upsert).
5. **Backfill route** (NEW) — `assertSuperadmin()`, paginate tenants, `enqueueXphereSync(id,'backfill')`, throttled; same worker path = same guarantees.

**Three-layer idempotency:** (1) **endpoint upsert-by-`external_id`** (authoritative, real guarantee); (2) **QStash `deduplicationId`** (`xphere:tenantId:reason`, 10-min window); (3) optional **`Idempotency-Key` header** to Xphere (`tenantId:reason`, belt-and-suspenders — confirm exact header name in the contract). Never key on email/phone (chain owners share emails → merge/split).

### Critical Pitfalls

1. **Wrong idempotency key (phone/email)** — match exclusively on immutable `external_id = tenants.id`; email/phone are attributes set on every sync, never lookup keys. Persist returned CRM ids to detect drift.
2. **At-least-once + out-of-order delivery (churn before activate)** — every sync is a full upsert (order-independent); **thin message + fat read** so a late retry re-sends current truth, not a stale snapshot; last-writer-wins by event time if a status must reflect a specific event.
3. **Building against an unbuilt contract** — encode the documented shape in `types.ts`, keep `mapping.ts` pure and offline-tested against a local stub, gate live calls on `XPHERE_*` env presence (ships dark, activates with zero code change), add an `XPHERE_SYNC_ENABLED` kill switch, run a **conformance test** only when the real endpoint lands. Do NOT modify the Xphere repo.
4. **QStash signature mistakes** — `runtime='nodejs'` (SDK needs Node crypto); read raw body **once** with `req.text()` and pass that same string to verify + `JSON.parse` (never re-stringify); supply **both** signing keys (rotation-safe); verify against a **pinned public-URL constant**, not `req.url` (the Coolify proxy rewrites host); reject unsigned → 401.
5. **Coolify (NOT Vercel) reachability + proxy URL rewriting** — `https://xmartmenu.skale.club/api/internal/xphere-sync` MUST be publicly resolvable over HTTPS with **no auth wall** in front of it (security = signature, not network); publish with the public origin (never `localhost` in deployed envs); use a tunnel for local dev; add a post-deploy reachability ping.
6. **Blocking core flows / partial-failure / poison storms** — enqueue-only fail-open producers (a CRM outage must not flip a successful webhook to 500); confirm `/api/v1/sync` atomicity (else checkpoint each entity id); classify transient (5xx/429/timeout → 500 retry) vs permanent (4xx/unknown-stage → 489 `Upstash-NonRetryable-Error: true` → DLQ); throttle the backfill to respect the `/api/v1/sync` rate limit; missing pipeline stage names → safe fallback + recorded error, never an infinite-retry fleet-wide outage.

## Implications for Roadmap

Based on combined research, the suggested phase structure is **dependency-forced and risk-front-loaded** — each layer reads/writes what the one below created, and the three things that cause cross-tenant corruption, an open CRM-write endpoint, or broken onboarding are built earliest. Phases 1-5 are fully buildable and exercisable **offline** against the documented contract; live integration is deferred until Xtimator ships `/api/v1/sync`, and the env-presence gate activates real calls with zero code change.

### Phase 1: Schema & Contract
**Rationale:** Front-loads the riskiest correctness decisions — the idempotency key and stage mapping — with no upstream dependency.
**Delivers:** Migration `054_xphere_sync_columns.sql` (`xphere_account_id/contact_id/opportunity_id/synced_at/sync_error`), `Tenant` interface update, `xphere/types.ts` (contract + `SyncReason` + `XPHERE_STAGES`), `xphere/mapping.ts` (pure, unit-testable, normalized MRR).
**Addresses:** `tenants` migration + entity/stage/MRR mapping (table stakes).
**Avoids:** Pitfall 1 (mapper hard-codes `external_id`), Pitfall 8 (central stage constants), and front-loads Pitfall 5 atomicity question.

### Phase 2: Worker + Client
**Rationale:** The keystone — the signature/retry contract everything relies on; built immediately after the schema/types it reads.
**Delivers:** `app/api/internal/xphere-sync/route.ts` (verify, fat-read, map, POST, write-back, 2xx/500/489); `xphere/client.ts` (env-gated `fetch` + `XphereTransientError`/`XpherePermanentError`).
**Uses:** `@upstash/qstash` `Receiver`, native `fetch` + `AbortSignal.timeout`, `createServiceClient()`, `getTenantPlan()`.
**Implements:** Worker route + network seam; thin-message/fat-read + raw-body verify + retry classification.
**Avoids:** Pitfalls 2, 4, 5, 10 (idempotent worker, signature/runtime, checkpointing, pinned-URL verify).

### Phase 3: Producer Hooks
**Rationale:** Enqueued jobs need somewhere to land first (Phase 2); enforces never-break-core-flows.
**Delivers:** `xphere/queue.ts` (`enqueueXphereSync`, fail-open) wired into onboarding (tenant-creation + resume), 3 Stripe webhook success branches, Connect callback — each after the DB write succeeds, before the final return.
**Addresses:** Events #1/#2/#4/#5 (+#6 Connect), async/non-blocking delivery.
**Avoids:** Pitfall 6 (enqueue-only, fail-open, after-idempotency-row).

### Phase 4: Backfill
**Rationale:** Reuses the producer + worker path (Phase 3) — one code path, one guarantee.
**Delivers:** `app/api/superadmin/xphere/backfill/route.ts` (`assertSuperadmin` + paginated, throttled, resumable enqueue; filters internal/test/opt-out tenants).
**Addresses:** One-time backfill (table stakes), dry-run mode (P2).
**Avoids:** Pitfall 9 (throttle/resumable, no stampede), Pitfall 7 (producer filters + `source`).

### Phase 5: Observability & Ops
**Rationale:** Uses the data the worker writes (Phase 4); makes silent failures visible.
**Delivers:** `xphere_sync_error`/`xphere_synced_at` in superadmin tenant detail, manual re-sync button, DLQ monitor, stage preflight, secret-scrub, `XPHERE_SYNC_ENABLED` kill switch, `.env.example` docs, post-deploy reachability ping.
**Addresses:** Error surfacing + manual re-sync (table stakes), sync-health dashboard (P2).
**Avoids:** Pitfall 9 (DLQ/kill switch), Pitfall 10 (reachability check), Security mistakes (secret scrub/gitleaks).

### Phase 6 (deferred): Live Conformance Test
**Rationale:** Cannot run until Xtimator ships the real `/api/v1/sync` + credentials.
**Delivers:** Run the full looks-done-but-isnt checklist against the real endpoint — idempotency, out-of-order, stale-retry, signature/rotation, partial-failure, missing-stage, backfill+live race, endpoint-down — then flip the kill switch on.

### Phase Ordering Rationale

- **Dependency-forced:** migration+types, lib, worker, hooks, backfill, observability. Each layer consumes what the previous produced (worker reads the new columns + mapping; hooks need the worker to land jobs; backfill reuses the producer; observability surfaces worker-written data).
- **Risk-front-loaded:** the idempotency key (P1), the signature + retry contract (P2), and enqueue-only producers (P3) — the three failure modes that cause cross-tenant corruption, an open CRM endpoint, or broken onboarding — are built earliest.
- **Contract-first / ships-dark:** P1-P5 build and test offline against a stub; the `XPHERE_*` env gate means the feature activates with zero code change when credentials land, decoupling the milestone from the separately-owned, in-progress endpoint.

### Research Flags

Phases likely needing deeper research (`/gsd:research-phase`) during planning:
- **Phase 2 (Worker):** Coolify reverse-proxy header config (`X-Forwarded-Proto`/`X-Forwarded-Host`) for the canonical pinned worker URL, and the exact `/api/v1/sync` request/response shape + atomicity — both are infra/contract unknowns that materially shape the worker.
- **Phase 4 (Backfill):** confirm a marketing-consent/internal-tenant flag exists before fanning PII into the CRM (LGPD/GDPR); if absent, escalate to product.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Schema):** straightforward `ALTER TABLE` + interface update + pure mapper; established repo migration convention (next free `054`).
- **Phase 3 (Producer hooks):** mirrors the proven Stripe idempotency-after-success discipline already in `webhooks/route.ts`; choke points verified line-by-line.
- **Phase 5 (Observability):** reuses existing superadmin UI + Sentry (`captureSecurityEvent`) patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | `@upstash/qstash@2.11.1` + all APIs verified against npm registry + official Upstash docs (2026-06-20); existing deps confirmed in `package.json`. |
| Features | HIGH | Every lifecycle event → choke point verified line-by-line in `stripe/webhooks/route.ts`, `onboarding/route.ts`, `connect/callback/route.ts`, `tenant-plan.ts`; mapping/stage/MRR decided in PROJECT.md. |
| Architecture | HIGH | All integration points verified directly against repo source; build order dependency-forced; mirrors existing fail-open + raw-body-verify + idempotency-after-success patterns. |
| Pitfalls | HIGH | Grounded in repo evidence (Stripe handler, CONCERNS.md, memory note) + official QStash docs; Coolify/proxy and unbuilt-contract risks confirmed against actual repo state. |

**Overall confidence:** HIGH

### Gaps to Address

- **`/api/v1/sync` contract atomicity + exact `Idempotency-Key` header name:** unknown until Xtimator documents/ships it. Handle by coding against a typed stub, treating shape mismatch as a recordable `xphere_sync_error` (not a crash), and running a conformance test on landing. If not atomic, checkpoint each entity id.
- **Marketing-consent / opt-out / internal-tenant flag:** unconfirmed whether such a field exists in the schema. Flag to product before syncing PII; filter at the producer; if absent, escalate rather than sync silently (LGPD/GDPR).
- **Coolify proxy header config for the canonical worker URL:** the public-vs-internal URL split and `X-Forwarded-*` handling must be confirmed so the pinned-URL signature verify works in prod. Validate with a post-deploy reachability ping; never verify against `req.url`.
- **Deployment-target doc drift:** older codebase STACK references Vercel, but the live target is Docker/Coolify (`xmartmenu.skale.club`). Confirm before building so the callback URL and reachability are correct. (PROJECT.md Stack already lists Docker/Coolify — treat that as authoritative.)
- **No test runner in repo yet:** the pure `mapping.ts` is the highest-value test target. Flag during planning whether to introduce a runner for it.

## Sources

### Primary (HIGH confidence)
- npm registry — `@upstash/qstash@2.11.1` (published 2026-06-16); transitive `jose@^5`, `crypto-js@>=4.2.0`, `neverthrow@^7`.
- Upstash QStash docs — signature/raw-body/two-key verify (`Receiver`/`verifySignatureAppRouter`, JWT sub=URL + body=SHA-256), retries (exponential backoff to 24h, `Upstash-Retries`, `Retry-After`, `489` + `Upstash-NonRetryable-Error` → DLQ, at-least-once/no-ordering), `deduplicationId` (10-min window), callbacks, local-tunnel reachability requirement.
- XmartMenu codebase (verified 2026-06-21) — `src/app/api/stripe/webhooks/route.ts`, `onboarding/route.ts`, `stripe/connect/callback/route.ts`, `src/lib/tenant-plan.ts` (override-resolved MRR), `superadmin-auth.ts`, `rate-limit.ts` (fail-open env gate), `observability.ts`, `src/types/database.ts`, `supabase/migrations/*` (next free `054`); repo evidence of Docker/Coolify GHCR deploy.
- `.planning/PROJECT.md` + auto-memory `xphere-crm-integration.md` — locked decisions (`external_id = tenants.id`, single shared Xphere org `e375f031-...`, do-not-modify-Xphere, QStash transport, owner-only Contact, env vars, corrected phone-to-email dedup).

### Secondary (MEDIUM confidence)
- HubSpot lifecycle-stage docs + Salesforce upsert-by-ExternalId / idempotent-record-write / integration-patterns guides — event-driven CRM-as-mirror, self-healing replays, webhook-live + scheduled-backfill consensus.
- Backfilling / data-pipeline design-pattern articles (ml4devs, dataskew.io 2026) — re-runnable MERGE/UPSERT by business key, DLQ, idempotency.

### Tertiary (LOW confidence)
- `.planning/codebase/CONCERNS.md` — hardcoded-fallback secret pattern, prior `.env.local` exposure, CI gaps (informs security pitfalls; needs re-verification during execution).

---
*Research completed: 2026-06-21*
*Ready for roadmap: yes*
