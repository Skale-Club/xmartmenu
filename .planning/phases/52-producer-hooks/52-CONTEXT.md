# Phase 52: Producer Hooks - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — specified by v2.4 SUMMARY.md + REQUIREMENTS.md FND-03, LIF-01..07)

<domain>
## Phase Boundary

Wire the lifecycle producers: a fail-open `src/lib/xphere/queue.ts` that publishes a thin `{ tenantId, reason }` message to QStash, enqueued at the existing choke points AFTER their DB write succeeds and BEFORE the final response. Covers events #1–#7. The worker (Phase 51) is the consumer; this phase only PRODUCES.

Delivers FND-03 (fail-open non-blocking producer) and LIF-01..07 (the lifecycle events + timeline-note dedup).
</domain>

<decisions>
## Implementation Decisions

### Queue producer (src/lib/xphere/queue.ts)
- `async function enqueueXphereSync(tenantId, reason, opts?): Promise<void>` — single fail-open choke point.
- Publishes via QStash `Client({ token: QSTASH_TOKEN }).publishJSON({ url: workerUrl, body: { tenantId, reason, eventId?, tags? }, retries, deduplicationId })`.
- `workerUrl` = pinned public worker URL (`XPHERE_WORKER_URL`/derived) — same constant the worker verifies against.
- `deduplicationId` = `xphere:${tenantId}:${reason}` (10-min QStash window) to coalesce duplicate enqueues.
- FAIL-OPEN + NON-BLOCKING: wrap the publish in try/catch, swallow errors (log/observe only), return void, NEVER throw into the caller. If QStash/Xphere env is unset → silent no-op (mirror the existing rate-limit fail-open env-gate). A CRM/QStash outage must NEVER break onboarding or flip a Stripe webhook 200→500.

### Producer choke points (MODIFY existing files — enqueue-only, after DB write)
| Event | Reason | File / location |
|---|---|---|
| #1 onboarding (tenant + subscription created) | `onboarded` | `src/app/api/onboarding/route.ts` — after the `tenant_subscriptions` insert; the early-return resume/already-configured paths use a `full-sync`-style reason WITHOUT re-posting the "onboarded" timeline note |
| #2 plan activated | `plan_activated` | `src/app/api/stripe/webhooks/route.ts` — `checkout.session.completed` (kind=plan) branch |
| #3 plan changed (upgrade/downgrade) | `plan_changed` | same handler — `customer.subscription.updated` when plan_id differs (needs prior plan_id diff; tag upgrade/downgrade) |
| #4 past_due | `past_due` | same handler — `invoice.payment_failed` / status past_due (needs tenant_id lookup from stripe_subscription_id) |
| #5 churn | `churned` | same handler — `customer.subscription.deleted` |
| #6 connect changed | `connect_changed` | `src/app/api/stripe/connect/callback/route.ts` (after stripe_connections upsert) + `account.updated` branch in webhooks |
| #7 first paid order | `first_order` | DEFERRED to a later phase (needs first-order detection) — keep the SyncReason but do not wire unless trivial |

- **Webhook placement:** collect a local `pendingSync` per branch and fire ONE `enqueueXphereSync` just before the final 200, AFTER the `processed_stripe_events` idempotency row is written — so a Stripe retry that short-circuits at the idempotency check does NOT double-enqueue.

### Timeline note dedup (LIF-07)
- Each lifecycle event carries a stable `eventId` (Stripe `event.id`, or `onboarding:<tenant_id>`), passed in the message and forwarded to the `/api/v1/sync` note payload, so QStash redelivery + Stripe retries never double-post a note. (The note dedup is enforced CRM-side by the contract; we just pass the id.)

### Upgrade/downgrade direction (LIF-03)
- In `customer.subscription.updated`, read the PRIOR `tenant_subscriptions.plan_id` BEFORE the handler overwrites it; compare plan sort_order/price to tag `upgrade` vs `downgrade`. Pass as `tags` in the message.

### Offline test
- Extend the scripts/ tsx convention: assert `enqueueXphereSync` is fail-open (swallows publish errors, no throw) and builds the correct `{tenantId, reason, deduplicationId}` with a stubbed QStash client — no real creds.

### Claude's Discretion
- Whether event #7 (first_order) is wired now or deferred (prefer defer unless a clean first-order signal already exists).
- Exact tag strings for upgrade/downgrade and status.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/xphere/client.ts` / `errors.ts` / `classify.ts` (Phase 51), `types.ts` (SyncReason), worker route already live.
- `src/lib/rate-limit.ts` — fail-open env-gate pattern to mirror in queue.ts.
- `src/app/api/stripe/webhooks/route.ts` — branches already exist: `checkout.session.completed` (kind=plan gate), `customer.subscription.updated`/`deleted`, `invoice.payment_failed`, `account.updated`; idempotency via `processed_stripe_events`; service-role client. Enqueue AFTER the idempotency row, before the final 200.
- `src/app/api/onboarding/route.ts` — tenant + `tenant_subscriptions` insert (~L187-198); has resume / already_configured early returns to handle without duplicate onboarded note.
- `src/app/api/stripe/connect/callback/route.ts` — `stripe_connections` upsert (~L69-83).

### Established Patterns
- Service-role reads in webhooks; idempotency-after-success; English; `src/lib/{domain}/` modules.

### Integration Points
- MODIFY: onboarding/route.ts, stripe/webhooks/route.ts, stripe/connect/callback/route.ts. NEW: src/lib/xphere/queue.ts (+ offline check).
</code_context>

<specifics>
## Specific Ideas

The #1 invariant: producers are enqueue-only and fail-open. The Stripe webhook returns 500 on business-logic failure to force a Stripe retry — an inline/throwing CRM call would make Stripe replay forever. So: enqueue after the DB write + idempotency row, wrapped in try/catch, never throw. Do NOT modify the Xphere repo. Ship dark behind the env gate.
</specifics>

<deferred>
## Deferred Ideas

Event #7 first-order signal (needs first_paid_order detection); backfill (Phase 53); observability UI + reachability ping (Phase 54); live conformance (Phase 55).
</deferred>
