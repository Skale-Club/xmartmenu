# Phase 54: Observability & Ops - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — specified by v2.4 SUMMARY.md + REQUIREMENTS.md OBS-01, OBS-02)

<domain>
## Phase Boundary

Make the CRM sync observable and operable: surface each tenant's sync state + last error in the superadmin tenant detail with a one-click manual re-sync, and lock down the ops safety rails (env kill switch honored by the producer, secrets server-only/gitleaks-safe, env documented). Final buildable phase; Phase 55 (live conformance) stays deferred.

Delivers OBS-01 (surfacing + manual re-sync) and OBS-02 (secret hygiene + kill switch).
</domain>

<decisions>
## Implementation Decisions

### OBS-01 — surfacing + manual re-sync
- **Surface** `xphere_synced_at` and `xphere_sync_error` (and the three `xphere_*_id` as "linked/not linked") in the superadmin tenant detail. The detail page `src/app/(superadmin)/tenants/[id]/page.tsx` already loads the tenant row (service-role) — include the new columns and pass to `TenantDetailClient.tsx`, which renders a small "CRM Sync" card: synced-at timestamp, error (if any), linked state.
- **Manual re-sync button** in `TenantDetailClient.tsx` → POST a new route `src/app/api/superadmin/tenants/[id]/xphere-resync/route.ts` (superadmin-gated via `assertSuperadmin`) that calls `enqueueXphereSync(tenantId, 'manual')` and returns `{ ok: true }`. Mirror the existing `chat-addon-override/route.ts` per-tenant superadmin action pattern. Button shows pending/result state; re-enqueues a full-sync for THAT tenant.

### OBS-02 — secret hygiene + kill switch
- **Kill switch:** ensure `XPHERE_SYNC_ENABLED` gates the PRODUCER (`src/lib/xphere/queue.ts`) — when explicitly disabled (e.g. unset/`'false'`/`'0'`), `enqueueXphereSync` is a silent no-op BEFORE publishing, so a single env flip stops all syncing with no code change. (The client already checks it; the producer-side gate makes the switch authoritative at the source.) Keep the existing fail-open behavior.
- **Secrets server-only:** confirm `XPHERE_API_KEY`, `QSTASH_TOKEN`, signing keys are read ONLY from server env, never `NEXT_PUBLIC_*`, never logged in `xphere_sync_error` (already scrubbed in the worker). `.env.example` already documents them as placeholders (gitleaks-safe) — verify completeness.

### Observability extras (from SUMMARY — include the cheap, code-only ones; skip infra)
- A short ops note / README section or `.env.example` comments documenting: the `XPHERE_SYNC_ENABLED` kill switch, the DLQ (QStash dashboard) for permanent failures, and a post-deploy reachability check of `/api/internal/xphere-sync` (curl an unsigned POST → expect 401, proving the route is reachable but signature-protected). These are doc/ops, not new infra.
- Sentry/observability capture of producer/worker failures may reuse `src/lib/observability.ts` if trivial; otherwise the `xphere_sync_error` column + DLQ is the v1 surface.

### Offline test
- Extend scripts/ tsx (or reuse existing gates): assert the producer kill switch (`XPHERE_SYNC_ENABLED` disabled → no publish) and that the resync route calls `enqueueXphereSync(id, 'manual')` with a stubbed enqueue + stubbed superadmin guard — no creds/network.

### Claude's Discretion
- Exact UI placement/styling of the CRM Sync card in TenantDetailClient (match existing card patterns; minimal, superadmin-internal — no heavy design needed).
- Whether kill-switch disabled is unset-default-on vs explicit-opt-in (prefer: enabled when env creds present AND XPHERE_SYNC_ENABLED not explicitly false → safe dark default).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(superadmin)/tenants/[id]/page.tsx` + `TenantDetailClient.tsx` — tenant detail surface to extend.
- `src/app/api/superadmin/tenants/[id]/chat-addon-override/route.ts` — pattern for a per-tenant superadmin POST action.
- `src/lib/superadmin-auth.ts` — `assertSuperadmin`.
- `src/lib/xphere/queue.ts` — `enqueueXphereSync` (add the kill-switch gate here).
- `src/lib/xphere/client.ts` — already references `XPHERE_SYNC_ENABLED`.
- `src/lib/observability.ts` — error capture (optional reuse).
- `.env.example` — env documentation.

### Established Patterns
- Superadmin pages under `src/app/(superadmin)/`; per-tenant superadmin API actions under `src/app/api/superadmin/tenants/[id]/`; service-role reads; English; `src/lib/{domain}/`.

### Integration Points
- MODIFY: `tenants/[id]/page.tsx`, `TenantDetailClient.tsx`, `src/lib/xphere/queue.ts`, possibly `.env.example`/README. NEW: `xphere-resync/route.ts` (+ offline check).
</code_context>

<specifics>
## Specific Ideas

Keep the UI minimal and superadmin-internal — a small "CRM Sync" card (synced-at, error, linked, re-sync button). The kill switch must be authoritative at the producer so one env flip halts all syncing. Secrets stay server-only. Do NOT modify the Xphere repo. The whole feature still ships dark — with no creds, the card shows "not synced" and re-sync is a harmless no-op.
</specifics>

<deferred>
## Deferred Ideas

Full sync-health dashboard (aggregate synced/errored/never-synced) — P2/Future. Live conformance test against the real /api/v1/sync — Phase 55 (blocked on Xtimator). Backfill dry-run — Future.
</deferred>
