---
phase: 52-producer-hooks
plan: 03
subsystem: integrations
tags: [xphere, crm, stripe-webhooks, lifecycle, fail-open, producer, idempotency]

# Dependency graph
requires:
  - phase: 52-producer-hooks
    provides: enqueueXphereSync fail-open producer (src/lib/xphere/queue.ts, plan 52-01)
  - phase: 51-xphere-foundation
    provides: SyncReason union (src/lib/xphere/types.ts)
provides:
  - Stripe webhook lifecycle producer wiring — plan_activated, plan_changed, past_due, churned, connect_changed
  - Single end-of-handler enqueue collector (pendingSync) fired after the processed_stripe_events idempotency row
affects: [53-backfill, 54-observability, stripe-webhook-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Collector pattern: each lifecycle branch SETS a local pendingSync; exactly ONE enqueueXphereSync fires after the idempotency upsert, before the 200"
    - "Enqueue-after-idempotency mirrors the existing idempotency-after-success rule so a Stripe retry that short-circuits at the idempotency check never double-enqueues"
    - "Every branch guards on its own !subErr / !error so a failed update (which 500s before the end-of-handler enqueue) can never enqueue"

key-files:
  created: []
  modified:
    - src/app/api/stripe/webhooks/route.ts

key-decisions:
  - "Single end-of-handler enqueue (not per-branch) — placed AFTER the processed_stripe_events upsert and BEFORE the 200, so the idempotency short-circuit on a Stripe retry returns early and never reaches the enqueue"
  - "past_due branch resolves tenant_id from stripe_subscription_id (invoice.payment_failed carries only the subscription id), gated on the prior update succeeding"
  - "account.updated select extended to include tenant_id so connect_changed can enqueue without a second query"
  - "plan_changed reads the PRIOR plan_id from tenant_subscriptions BEFORE the status update, resolves the NEW plan_id from the Stripe subscription's first item price id, and tags upgrade/downgrade by plans.sort_order; status-only updates do not enqueue plan_changed"
  - "DEVIATION: plan assumed plans columns stripe_price_id_monthly / stripe_price_id_annual; the actual Plan interface (src/types/database.ts) uses stripe_price_monthly_id / stripe_price_annual_id (migration 052). Used the real column names per the plan's documented fallback — no schema change needed, price-id lookup retained"

patterns-established:
  - "Pattern: webhook lifecycle producers never enqueue inside a branch — branches only set pendingSync; the single fail-open enqueue lives at the end of the success path"

requirements-completed: [LIF-02, LIF-03, LIF-04, LIF-05, LIF-06, LIF-07]

# Metrics
duration: 4min
completed: 2026-06-21
---

# Phase 52 Plan 03: Stripe Webhook Lifecycle Producers Summary

**Wired the full Stripe-driven subscription + Connect lifecycle into the CRM: five webhook branches (`checkout.session.completed`, `customer.subscription.updated`/`deleted`, `invoice.payment_failed`, `account.updated`) each set a local `pendingSync`, and exactly ONE fail-open `enqueueXphereSync` fires after the `processed_stripe_events` idempotency row and before the 200 — so a Stripe retry that short-circuits at the idempotency check never double-enqueues, and a QStash outage can never flip a successful webhook 200 to 500.**

## What Was Built

- **Collector + single enqueue (Task 1):** `let pendingSync` declared next to `updateResult`; a single `enqueueXphereSync(pendingSync.tenantId, pendingSync.reason, { eventId, ...tags })` fires after the idempotency upsert, forwarding Stripe `event.id` as `eventId` (LIF-07 note dedup).
- **#2 plan_activated (LIF-02):** `checkout.session.completed` (kind=plan) sets `plan_activated`, guarded on `!subErr`.
- **#4 past_due (LIF-04):** `invoice.payment_failed` looks up `tenant_id` from `stripe_subscription_id`, then sets `past_due`, guarded on `!error`.
- **#5 churned (LIF-05):** `customer.subscription.deleted` sets `churned`, guarded on `!error && deleted`.
- **#6 connect_changed (LIF-06, webhook half):** `account.updated` select extended with `tenant_id`; sets `connect_changed`.
- **#3 plan_changed (LIF-03, Task 2):** reads the PRIOR `plan_id` before the update, resolves the NEW `plan_id` from the Stripe subscription item price id, and on a genuine plan change sets `plan_changed` with an `upgrade`/`downgrade` tag derived from `plans.sort_order`. Status-only updates do not enqueue.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected plans price-id column names**
- **Found during:** Task 2
- **Issue:** The plan's example used `stripe_price_id_monthly` / `stripe_price_id_annual`, but the `Plan` interface in `src/types/database.ts` (migration 052) defines `stripe_price_monthly_id` / `stripe_price_annual_id`.
- **Fix:** Used the actual column names in the `.or(...)` price-id lookup. This is the plan's own documented fallback ("use the names found in the Plan interface"). No schema change; the price-id → plans.id mapping is retained rather than falling back to the app-persisted plan_id.
- **Files modified:** src/app/api/stripe/webhooks/route.ts
- **Commit:** b9bf131

## Verification

- `npx tsc --noEmit` exits 0 (after both tasks).
- All five reasons present: `plan_activated`, `plan_changed`, `past_due`, `churned`, `connect_changed`.
- Exactly one end-of-handler `enqueueXphereSync(pendingSync...)`, positioned after the `processed_stripe_events` upsert (line ~391) and before the final 200 (enqueue at line ~411).
- Every enqueue forwards `event.id` as `eventId`.
- No branch enqueues directly; every branch guards on its `!subErr` / `!error` so the 500-retry path cannot enqueue.

## Known Stubs

None. All five lifecycle producers are fully wired to live data; no placeholder or empty-value stubs introduced.

## Commits

- ae2173d: feat(52-03): wire 4 Stripe webhook lifecycle producers into CRM enqueue
- b9bf131: feat(52-03): tag plan_changed upgrade/downgrade from prior plan (LIF-03)

## Self-Check: PASSED

- route.ts present, SUMMARY present, both commits (ae2173d, b9bf131) in history.
