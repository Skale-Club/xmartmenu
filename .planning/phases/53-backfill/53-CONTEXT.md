# Phase 53: Backfill - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — specified by v2.4 SUMMARY.md + REQUIREMENTS.md BKF-01)

<domain>
## Phase Boundary

A superadmin-only route that hydrates the CRM with all EXISTING tenants by enqueuing a full-sync through the SAME Phase 52 producer + Phase 51 worker path — one code path, one set of guarantees. Throttled, resumable, idempotent. No new sync logic; it just fans out `enqueueXphereSync(tenantId, 'backfill')` over the tenant table.

Delivers BKF-01.
</domain>

<decisions>
## Implementation Decisions

### Route (src/app/api/superadmin/xphere/backfill/route.ts)
- POST, superadmin-only — reuse the existing superadmin auth guard (`assertSuperadmin()` / the pattern used by other `src/app/api/superadmin/*` routes). Reject non-superadmin → 401/403.
- Paginate `tenants` (service-role) in batches (e.g. 100 by `created_at`/id cursor); for each tenant call `enqueueXphereSync(tenant.id, 'backfill')`.
- THROTTLE: small delay between batches (or rely on QStash rate limits) so the `/api/v1/sync` endpoint isn't stampeded. RESUMABLE: accept a `?cursor=`/`afterId` param (or return the last-processed id) so a re-invocation continues; idempotent because the worker upserts by `external_id`.
- Filtering (PII hygiene): skip tenants flagged internal/test/opt-out IF such a flag exists in schema; if none exists, document that no opt-out field exists yet (flag to product) and sync all — do NOT invent a column this phase.
- Return a JSON summary: `{ enqueued, skipped, nextCursor, done }`.
- Fail-open per-tenant: `enqueueXphereSync` already swallows; a single tenant failing must not abort the batch.

### Reason
- Use `reason: 'backfill'` (already in the SyncReason union from Phase 50). The mapper synthesizes a stable note id (`onboarding:<tenant_id>` style or a backfill id) so re-runs do not double-post notes.

### Offline test
- Extend the scripts/ tsx convention: assert the backfill handler enqueues once per tenant over a stubbed tenant list + stubbed enqueue, is idempotent/resumable (cursor advances), and rejects non-superadmin — no real creds/network.

### Claude's Discretion
- Batch size + throttle delay specifics.
- Whether resumability is cursor-param based or a single long run with internal paging (prefer cursor param for safety under serverless/container timeouts).
- Dry-run mode is a P2/Future item — only add if trivial; otherwise defer.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/xphere/queue.ts` — `enqueueXphereSync(tenantId, reason)` (Phase 52), fail-open.
- `src/lib/superadmin-auth.ts` (or the guard used by `src/app/api/superadmin/*`) — superadmin gate to reuse.
- `src/lib/supabase` — service-role client for paginating tenants.
- Existing `src/app/api/superadmin/*` routes — pattern for superadmin route + auth.

### Established Patterns
- Superadmin routes under `src/app/api/superadmin/`; service-role reads; English; `src/lib/{domain}/`.

### Integration Points
- NEW: src/app/api/superadmin/xphere/backfill/route.ts (+ offline check). Reuses queue.ts + superadmin auth. No changes to worker/producers.
</code_context>

<specifics>
## Specific Ideas

Reuse the exact producer→worker path so backfill has identical idempotency/retry guarantees — do NOT write a parallel sync path. Throttle to respect the `/api/v1/sync` rate limit. Idempotent + resumable so it is safe to re-run. Do NOT modify the Xphere repo. Ship dark behind the env gate (no env → enqueue is a no-op, so backfill is harmless until creds land).
</specifics>

<deferred>
## Deferred Ideas

Backfill dry-run/report mode (P2); sync-health dashboard (Phase 54 / Future); observability surfacing (Phase 54); live conformance (Phase 55).
</deferred>
