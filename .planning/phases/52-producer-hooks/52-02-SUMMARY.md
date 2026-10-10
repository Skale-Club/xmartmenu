---
phase: 52-producer-hooks
plan: 02
subsystem: integrations
tags: [xphere, crm, onboarding, stripe-connect, oauth, fail-open, producer]

# Dependency graph
requires:
  - phase: 52-producer-hooks
    provides: enqueueXphereSync fail-open producer (src/lib/xphere/queue.ts, plan 52-01)
  - phase: 51-xphere-foundation
    provides: SyncReason union (src/lib/xphere/types.ts)
provides:
  - Onboarding producer wiring — 'onboarded' on new tenant, 'manual' full-sync on resume paths (LIF-01)
  - Stripe Connect OAuth callback producer wiring — 'connect_changed' after stripe_connections upsert (LIF-06 callback half)
affects: [52-03, stripe-webhook-wiring, account.updated-half]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Producers enqueue AFTER the DB write succeeds, before the response; fail-open via enqueueXphereSync never blocks/throws"
    - "Resume self-heal uses reason 'manual' (no note) to avoid double-posting the onboarded timeline note"

key-files:
  created: []
  modified:
    - src/app/api/onboarding/route.ts
    - src/app/api/stripe/connect/callback/route.ts

key-decisions:
  - "Resume paths use reason 'manual' (the only reason that emits no note) so the onboarded note is never double-posted; new-tenant path uses 'onboarded' with no eventId so the worker dedups on onboarding:<tenant.id>"
  - "wasResume boolean declared once at handler scope (after currentProfile fetch) so the resume-finish path can enqueue 'manual' before the shared success return"

patterns-established:
  - "Pattern: enqueue only on success branches — never on validation 400s, 403, create-tenant 500s, or any Stripe error/redirect branch"

requirements-completed: [LIF-01, LIF-06]

# Metrics
duration: 5min
completed: 2026-06-21
---

# Phase 52 Plan 02: Onboarding + Stripe Connect Callback Producers Summary

**Wired two disjoint Xphere producers — onboarding enqueues `onboarded` after the subscription insert (and `manual` full-sync on both resume paths, no duplicate note), and the Stripe Connect OAuth callback enqueues `connect_changed` after the `stripe_connections` upsert — all fail-open via `enqueueXphereSync`, never blocking or throwing into the response.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-21T09:39:50Z
- **Completed:** 2026-06-21T09:43:08Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Onboarding new-tenant path enqueues `onboarded` immediately after the `tenant_subscriptions` insert error guard, before the success response (LIF-01, event #1). No `eventId` → the worker synthesizes `onboarding:<tenant.id>` for note dedup.
- `already_configured` early return enqueues a `manual` full-sync so a fully-configured tenant self-heals into the CRM without re-posting the onboarded note.
- Resume-but-no-menu path enqueues a `manual` full-sync before the shared success return, gated by a `wasResume` boolean, so a resume that completes menu creation re-asserts CRM state without re-firing `onboarded`.
- Stripe Connect OAuth callback enqueues `connect_changed` after the `stripe_connections` upsert succeeds and after its `db_error` guard, before the success redirect (LIF-06, callback half).
- No enqueue on any error/early-error branch (validation 400s, superadmin 403, create-tenant 500s, or Stripe access_denied/missing_code/invalid_state/exchange_failed/db_error redirects).

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire the onboarding producer (onboarded + resume full-sync)** - `c6c659b` (feat)
2. **Task 2: Wire the Stripe Connect OAuth callback producer (connect_changed)** - `0f894a5` (feat)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/app/api/onboarding/route.ts` - Added `enqueueXphereSync` import; `wasResume` flag; `onboarded` enqueue after subscription insert; two `manual` enqueues on the already_configured and resume-finish paths.
- `src/app/api/stripe/connect/callback/route.ts` - Added `enqueueXphereSync` import; `connect_changed` enqueue after the `stripe_connections` upsert success guard, before the success redirect.

## Decisions Made
- Used `currentProfile.tenant_id` for the already_configured enqueue (guaranteed-present id in that branch) and `tenant.id` for the resume-finish enqueue (the resolved tenant object), keeping each enqueue keyed to the id available in its scope.
- Declared `wasResume` once at handler scope (right after the superadmin guard, where `currentProfile` is resolved) so it is visible at both the resume branch and the final success return.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. `npx tsc --noEmit` passed on first run (exit 0). All grep acceptance criteria verified: onboarding has the import, one `onboarded`, exactly two `manual`, and `wasResume`; the onboarded enqueue (line 214) sits after the `Failed to create subscription` guard (line 207); the connect enqueue (line 90) sits after the `DB upsert failed` guard (line 82).

## User Setup Required
None - no external service configuration required. Both producers ship dark behind the `XPHERE_*` env gate via `enqueueXphereSync`; activation is env-level (no code change).

## Next Phase Readiness
- Events #1 (onboarding) and #6 callback half (Connect OAuth) now reach the CRM when the env gate opens.
- Plan 52-03 owns `src/app/api/stripe/webhooks/route.ts` (Stripe lifecycle webhooks) and the `account.updated` half of event #6 — left untouched here per the disjoint-files constraint.

## Self-Check: PASSED

- FOUND: src/app/api/onboarding/route.ts (enqueueXphereSync wiring)
- FOUND: src/app/api/stripe/connect/callback/route.ts (enqueueXphereSync wiring)
- FOUND: commit c6c659b
- FOUND: commit 0f894a5
- tsc --noEmit: exit 0

---
*Phase: 52-producer-hooks*
*Completed: 2026-06-21*
