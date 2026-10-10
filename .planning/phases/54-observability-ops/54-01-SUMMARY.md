---
phase: 54-observability-ops
plan: 01
subsystem: ui
tags: [xphere, crm, superadmin, observability, qstash, nextjs]

# Dependency graph
requires:
  - phase: 50-schema-contract
    provides: "Migration 054 xphere_* tenant columns + SyncReason 'manual' in src/lib/xphere/types.ts"
  - phase: 51-worker-client
    provides: "enqueueXphereSync producer choke point (src/lib/xphere/queue.ts)"
provides:
  - "Superadmin tenant detail surfaces xphere_synced_at, xphere_sync_error, and linked/not-linked state"
  - "One-click manual re-sync that re-enqueues a full Xphere sync via the standard producer path"
  - "Superadmin-gated POST /api/superadmin/tenants/[id]/xphere-resync route"
affects: [54-observability-ops, ops, support]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-tenant superadmin POST mirrors chat-addon-override route (assertSuperadmin guard, params Promise, { ok: true } return)"
    - "Read-only observability card reuses existing TenantDetailClient Tailwind card classes (no new design system)"

key-files:
  created:
    - "src/app/api/superadmin/tenants/[id]/xphere-resync/route.ts"
  modified:
    - "src/app/(superadmin)/tenants/[id]/page.tsx"
    - "src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx"

key-decisions:
  - "Re-sync goes through enqueueXphereSync(id, 'manual') — fail-open, ships dark, emits no timeline note; the UI shows 'Re-sync enqueued' rather than confirming delivery."
  - "Card degrades to 'Never synced' / 'Not linked' when all xphere_* fields are null (ships-dark default before any sync runs)."

patterns-established:
  - "Superadmin manual re-trigger of a producer hook = thin assertSuperadmin POST that calls the queue choke point and returns { ok: true }."

requirements-completed: [OBS-01]

# Metrics
duration: 3min
completed: 2026-06-21
---

# Phase 54 Plan 01: CRM Sync Observability Summary

**Superadmin tenant detail now shows each tenant's Xphere sync state (last-synced, linked/not-linked, sync error) with a one-click re-sync button that re-enqueues a full sync via enqueueXphereSync(id, 'manual').**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-21T10:18:42Z
- **Completed:** 2026-06-21T10:21:12Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- New superadmin-gated `POST /api/superadmin/tenants/[id]/xphere-resync` mirroring the chat-addon-override pattern; calls `enqueueXphereSync(id, 'manual')` and returns `{ ok: true }`.
- Extended the service-role tenant query with the five `xphere_*` columns, flowing through to the client via the existing prop spread.
- Added a minimal "CRM Sync" card to TenantDetailClient: synced-at line, Linked/Not-linked badge, red sync-error box, and a re-sync button with pending/result state. Degrades cleanly when all fields are null.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add superadmin-gated xphere-resync POST route** - `179e56d` (feat)
2. **Task 2: Extend tenant query with xphere_* columns** - `b7cb3f7` (feat)
3. **Task 3: Render CRM Sync card + re-sync button** - `d56d644` (feat)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/app/api/superadmin/tenants/[id]/xphere-resync/route.ts` - New superadmin POST route; re-enqueues a full Xphere sync (fail-open, ships dark).
- `src/app/(superadmin)/tenants/[id]/page.tsx` - Tenant select extended with the five `xphere_*` sync-state columns.
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` - Tenant interface widened; CRM Sync card + `handleResync` + re-sync state hooks.

## Decisions Made
- Re-sync surfaces "Re-sync enqueued" (producer-path semantics) rather than confirming CRM delivery — matches the thin-message/fat-read and fail-open design from Phases 50-52.
- Card uses the same `bg-white border border-zinc-200 rounded-xl p-5` card and existing green/red banner classes as the AI Tools card — no new design tokens.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. `npx tsc --noEmit` exited 0 after each task.

## User Setup Required
None - no external service configuration required. The re-sync route ships dark behind the existing `XPHERE_*` / `QSTASH_TOKEN` env gate (harmless no-op when unconfigured). Phase 54-02 owns queue.ts/.env.example/README documentation.

## Next Phase Readiness
- OBS-01 surfacing + manual re-sync complete. 54-02 (env/docs) and 54-03 remain in this phase.
- Scope respected: queue.ts, .env.example, and README were NOT touched (owned by 54-02).

## Self-Check: PASSED

- All 3 created/modified files exist on disk.
- All 3 task commits (179e56d, b7cb3f7, d56d644) present in git log.
- `npx tsc --noEmit` exits 0.

---
*Phase: 54-observability-ops*
*Completed: 2026-06-21*
