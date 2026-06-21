---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: CRM & Integrations
status: verifying
stopped_at: Completed 52-01-PLAN.md
last_updated: "2026-06-21T09:39:50.908Z"
last_activity: 2026-06-21
progress:
  total_phases: 20
  completed_phases: 11
  total_plans: 29
  completed_plans: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-25)

**Core value:** A restaurant owner can go from zero to a live, shareable digital menu in under 10 minutes — no design skills, no developer needed.
**Current focus:** Phase 52 — Producer Hooks

## Current Position

Phase: 52
Current Plan: 2
Total Plans in Phase: 4
Status: In progress (52-01 done)
Last activity: 2026-06-21

Progress: [█████████░] 86% (Phase 52: 1/4 plans)

## Milestone Overview

**v2.4 CRM & Integrations (Xphere CRM Sync)** — Phases 50-55. One-way outbound sync mirroring every tenant into the dedicated Xphere CRM org (`e375f031-4d9a-42b1-9f3c-ade805650442`); XmartMenu DB stays the source of truth. Dependency-forced, risk-front-loaded build; Phases 50-54 are buildable/testable offline against the documented contract and ship dark behind the `XPHERE_*` env gate; Phase 55 is deferred until the Xtimator-owned `/api/v1/sync` endpoint + credentials land.

| Phase | Name | Requirements | Status |
|---|---|---|---|
| 50 | Schema & Contract | FND-01, FND-02 | Ready to plan |
| 51 | Worker + Client | FND-04, FND-05, FND-06 | In progress (51-01 done) |
| 52 | Producer Hooks | FND-03, LIF-01..07 | In progress (52-01 done) |
| 53 | Backfill | BKF-01 | Not started |
| 54 | Observability & Ops | OBS-01, OBS-02 | Not started |
| 55 | Live Conformance Test | (verification only) | Blocked (external dependency) |

Coverage: 16/16 v2.4 requirements mapped (FND-01..06, LIF-01..07, BKF-01, OBS-01..02). 100%.

**Hard constraint (all phases):** Do NOT modify the Xphere repo — `/api/v1/sync`, `external_id` indexes, and `sync:write` scope are the Xtimator effort. Build against the documented contract; configure stages + API key data-only in the Xphere org; secrets server-only; ship dark behind the env gate + `XPHERE_SYNC_ENABLED` kill switch. All code in English.

**Paused — v2.3 Brand & Marketing Refresh** (resume later or in parallel). Phases preserved in ROADMAP.md:

| Phase | Name | Seeds | Status |
|---|---|---|---|
| 45 | Icon Resolver Fix | SEED-025 | ✓ Complete |
| 46 | Global Color Rebrand | SEED-026 | ○ Paused |
| 47 | Features Section Layout | SEED-027 | ○ Paused |
| 48 | CTA Full-Bleed + Background Image | SEED-028 | ○ Paused |
| 49 | DB Seeds — Color & Branding Defaults | SEED-029 | ○ Paused |

## Accumulated Context

### Decisions

- [v2.4 Roadmap]: `external_id = tenants.id` is the immutable idempotency key — never email/phone (chain owners share emails → merge/split). Persist returned CRM ids to detect drift.
- [v2.4 Roadmap]: Thin message + fat read — producers enqueue `{ tenantId, reason }`; the worker re-reads live state so late/out-of-order retries re-send current truth, not a stale snapshot.
- [v2.4 Roadmap]: Producers are enqueue-only and fail-open — a CRM outage must never block onboarding or flip a successful Stripe webhook to 500. Enqueue after the DB write succeeds, never throw.
- [v2.4 Roadmap]: Worker runs Node runtime; reads raw body once via `req.text()` and verifies QStash signature against both signing keys + a pinned public worker URL (not `req.url` — Coolify proxy rewrites host).
- [v2.4 Roadmap]: Retry classification — transient (5xx/429/network/timeout) → non-2xx so QStash retries; permanent (unknown stage, missing tenant) → `489` + `Upstash-NonRetryable-Error` → DLQ.
- [v2.4 Roadmap]: Opportunity amount = normalized MRR via `getTenantPlan()` (override/grandfather) then `annual_price / 12` for annual, else `monthly_price` — never raw `plans.monthly_price`.
- [v2.4 Roadmap]: Stage model Onboarding → Active/Won → At Risk (re-openable on past_due) → Churned/Lost; stage names live as `XPHERE_STAGES` constant in `types.ts`.
- [v2.4 Roadmap]: Single new runtime dep `@upstash/qstash@2.11.1`; reuse existing `zod`, `@sentry/nextjs`, `@upstash/redis`, native `fetch`. No axios/ky/BullMQ/Inngest.
- [v2.4 Roadmap]: Deployment target is Docker/Coolify (`xmartmenu.skale.club`), NOT Vercel — public worker URL must resolve over HTTPS with no auth wall (security = signature, not network).
- [Phase 50]: Migration 054 adds five nullable xphere_* sync-state columns to tenants (FND-01); created but not yet applied to the live DB — schema + types only this plan.
- [Phase 50]: FND-02: /api/v1/sync contract + SyncReason + XPHERE_STAGES isolated in src/lib/xphere/types.ts (single file to change when Xtimator finalizes shape); buildSyncPayload mapper is pure (no getTenantPlan/IO), consumes resolved EffectivePlan, keyed external_id=tenants.id, MRR via normalizeMrr.
- [Phase 50]: Pure mapper tested via scripts/test-xphere-mapping.ts tsx assertion harness (npm run test:xphere) — no vitest added, matches existing scripts/*.ts convention.
- [Phase 50]: Consolidated the offline Xphere mapper gate into one canonical scripts/xphere-mapping-check.ts + npm run xphere:check (node:assert/strict, non-zero exit on failure); removed the duplicate test-xphere-mapping.ts/test:xphere from plan 50-02.
- [Phase 51]: [Phase 51-01]: postXphereSync is the single Xphere network seam — env-gated dark no-op { disabled: true } sentinel, single fetch + 10s AbortSignal timeout, throws XphereTransientError (5xx/429/network/timeout) vs XpherePermanentError (4xx) for QStash retry-vs-DLQ. Single new runtime dep @upstash/qstash@2.11.1.
- [Phase 51]: Malformed/unparseable queue payload and no-subscription are permanent (489 + Upstash-NonRetryable-Error → DLQ); missing tenant is a 200 no-op
- [Phase 51]: QStash signature verified against a pinned XPHERE_WORKER_URL/NEXT_PUBLIC_APP_URL constant (not req.url) so Coolify proxy host rewrite cannot break prod verification
- [Phase 51]: Worker retry classification (transient->500, permanent->489+Upstash-NonRetryable-Error, disabled/gone/success->200) is a pure classifyWorkerOutcome() shared by route + offline gate
- [Phase 52]: Xphere QStash producer is a single fail-open choke point (enqueueXphereSync) so every call site is non-blocking by construction

### Pending Todos

- Phase 51/53 may need `/gsd-research-phase` during planning (Coolify proxy header config + exact `/api/v1/sync` contract/atomicity; marketing-consent/internal-tenant filter for PII).
- Confirm whether to introduce a test runner (`vitest`/`tsx`) for the pure `mapping.ts` — no test runner in `package.json` yet.
- v2.3 Phases 46, 47, 48 ready to resume; Phase 49 (DB seeds) blocked on visual confirmation of 46-48.

### Blockers/Concerns

- **Phase 55 (Live Conformance Test) is BLOCKED** on the external Xtimator deliverable: the real `/api/v1/sync` endpoint, `external_id` indexes, `sync:write` scope, and live credentials. Do not plan Phase 55 until these are confirmed available.
- Open contract items: exact `/api/v1/sync` request/response shape + idempotency-key header name; `/api/v1/sync` atomicity (if not atomic, checkpoint each entity id); marketing-consent/opt-out/internal-tenant flag existence (escalate to product before syncing PII).

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|---|---|---|---|---|
| 52 | 01 | 2min | 1 | 1 |

## Session Continuity

Last session: 2026-06-21T09:39:50.904Z
Stopped at: Completed 52-01-PLAN.md

---

**Project Status: IN DEVELOPMENT**

| Item | Status |
|---|---|
| Seeds | SEED-025 through SEED-029 planted (v2.3) |
| Milestones | 13 shipped (v1.0 → v2.2), v2.3 paused, v2.4 active |
| Phases | 44 shipped, v2.3 (45-49) paused, v2.4 (50-55) planned |
| Blockers | Phase 55 blocked on external Xtimator `/api/v1/sync` |
