# Phase 50: Schema & Contract - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — fully specified by v2.4 research SUMMARY.md + REQUIREMENTS.md FND-01/FND-02)

<domain>
## Phase Boundary

Front-load the riskiest correctness decisions of the Xphere CRM sync with zero upstream dependency: the CRM sync-state columns on `tenants`, the typed `/api/v1/sync` contract, the stage/`SyncReason` constants, and a pure, offline-testable mapping function (entity mapping + normalized MRR). No network, no queue, no producers yet — those are Phases 51–52.

Delivers FND-01 (migration + `Tenant` type) and FND-02 (`src/lib/xphere/` types + mapping).
</domain>

<decisions>
## Implementation Decisions

### Schema (FND-01)
- Migration file `supabase/migrations/054_xphere_sync_columns.sql` (next free number; 051/052/053 exist). Idempotent `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS`.
- Columns: `xphere_account_id text`, `xphere_contact_id text`, `xphere_opportunity_id text`, `xphere_synced_at timestamptz`, `xphere_sync_error text` — all nullable.
- Update the `Tenant` interface in `src/types/database.ts` to reflect all five columns.
- `external_id = tenants.id` (immutable) is the idempotency key — never email/phone.

### Contract & constants (FND-02 — types.ts)
- `src/lib/xphere/types.ts` encodes the documented `POST /api/v1/sync` request/response shape (account + contact + opportunity + note + `source='xmartmenu'`), isolated so the unknown exact shape lives in ONE file.
- `SyncReason` union: `onboarded | plan_activated | plan_changed | past_due | churned | connect_changed | backfill | manual`.
- `XPHERE_STAGES` constant — single source of truth for stage names: `Onboarding` → `Active` (Won) → `At Risk` (open) → `Churned` (Lost).

### Mapping (FND-02 — mapping.ts)
- Pure function `buildSyncPayload(input)` where input = tenant + store-admin profile + tenant_subscription + plan + reason → request payload. No I/O, no imports of network/queue.
- Opportunity amount = normalized MRR: resolve via `getTenantPlan()` semantics (override/grandfather), then `annual_price / 12` when `billing_cycle === 'annual'`, else `monthly_price`. Never read raw `plans.monthly_price`.
- Stage selected from subscription status + reason using `XPHERE_STAGES`.
- Contact = store-admin (owner) only, never staff.

### Offline test (success criterion 4)
- The repo has no test runner. Add a `tsx` script under `scripts/` (matches existing `scripts/*.ts` convention) that asserts payload shape, stage selection, and MRR normalization against fixture rows — runnable with no QStash/Xphere creds. Prefer `tsx` script over introducing vitest unless planning decides otherwise.

### Claude's Discretion
- Exact field names inside the `/api/v1/sync` payload (documented contract not yet finalized by Xtimator) — encode best-known shape in `types.ts`, keep it the only place to change later.
- Whether to add `vitest` vs a `tsx` assertion script for the offline mapper check.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/tenant-plan.ts` — `getTenantPlan()` resolves override/grandfathered pricing (monthly + annual). Mapping MUST source MRR from this, not raw plans.
- `src/types/database.ts` — `Tenant` interface to extend.
- `supabase/migrations/` — existing idempotent migration convention; highest is `053`.
- `scripts/*.ts` — existing `tsx`-style scripts (e.g. `stripe-setup-plans.ts`, `apply-migration.mjs`) for offline tooling.

### Established Patterns
- `src/lib/{domain}/` module layout, no barrel files.
- Code in English.

### Integration Points
- None this phase — pure schema + lib. Producers/worker wire in later phases.
</code_context>

<specifics>
## Specific Ideas

Build against the documented contract only; do NOT modify the Xphere repo. Feature ships dark — nothing in this phase calls the network. Single new dependency `@upstash/qstash@2.11.1` is NOT needed until Phase 51 (worker), so it need not be installed here unless planning prefers to add it upfront.
</specifics>

<deferred>
## Deferred Ideas

Worker route, client network seam, QStash queue, producer hooks, backfill, observability — Phases 51–54.
</deferred>
