---
phase: 10-image-seeding
plan: 03
subsystem: superadmin / AI image seeding UI + trigger
tags: [superadmin, ai, image-seeding, github-actions, polling]
requires:
  - 10-01 (ai_jobs table, AiJob type, internal revalidate endpoint)
provides:
  - "POST /api/superadmin/tenants/[id]/seed-images — creates ai_jobs row + dispatches GH Actions workflow_dispatch"
  - "GET /api/superadmin/tenants/[id]/seed-status?jobId=... — returns { status, errorMessage } from ai_jobs"
  - "GET /api/superadmin/tenants/[id]/products-list?menuId=... — lists products for a menu (AI-09)"
  - "TenantDetailClient image seeding UI with bulk button + per-product buttons + 3s polling"
affects:
  - "TenantDetailClient.tsx — additive UI section, Phase 9 AI Tools untouched"
tech-stack:
  added: []
  patterns:
    - "Trigger + poll pattern: short Vercel route inserts DB row + dispatches GH Actions, UI polls status row every 3s"
    - "workflow_dispatch returns 204 (no body) — never call .json() on the dispatch response"
    - "tenant_id filter on ai_jobs reads prevents cross-tenant access even if jobId is tampered with"
    - "revalidatePath called from polling endpoint when status transitions to 'complete'"
key-files:
  created:
    - "src/app/api/superadmin/tenants/[id]/seed-images/route.ts"
    - "src/app/api/superadmin/tenants/[id]/seed-status/route.ts"
    - "src/app/api/superadmin/tenants/[id]/products-list/route.ts"
  modified:
    - "src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx"
decisions:
  - "Polling cadence 3000ms with 100-poll cap (~5min timeout) — matches D-08; no websocket dependency"
  - "Single handleSeedImages function handles bulk (productId='') and per-product (productId=id) — avoids duplicating polling logic"
  - "Per-product buttons hidden for products that already have image_url (skip-existing per D-09)"
  - "products-list endpoint mirrors existing categories-list endpoint pattern (auth + service + simple SELECT)"
  - "Image seeding UI added as a third subsection under AI Tools, after the Phase 9 per-item seeding block — purely additive"
metrics:
  duration: "~3 min"
  completed: "2026-05-07"
  tasks: 2
  files: 4
---

# Phase 10 Plan 03: Image Seeding UI + Trigger Routes — Summary

Vercel API routes (trigger + poller) and TenantDetailClient image seeding UI wired together with a 3-second polling loop, completing the user-facing entry points for Phase 10.

## Files Created

- `src/app/api/superadmin/tenants/[id]/seed-images/route.ts` — POST trigger; assertSuperadmin guard, inserts `ai_jobs` row (feature_key `image_seeding` for bulk or `image_single` for per-product), dispatches `image-seeding.yml` via `workflow_dispatch` with `Bearer GH_PAT`, checks `status !== 204` (never `.json()`), returns `{ jobId }`.
- `src/app/api/superadmin/tenants/[id]/seed-status/route.ts` — GET poller; assertSuperadmin guard, reads `ai_jobs` filtered by both `id` and `tenant_id` (prevents cross-tenant access), returns `{ status, errorMessage }`. On `complete`, looks up tenant slug and calls `revalidatePath(/${slug})` so the public menu reflects new images on next load.
- `src/app/api/superadmin/tenants/[id]/products-list/route.ts` — GET helper for AI-09; assertSuperadmin guard, returns `{ products: { id, name, image_url, category_id }[] }` for a given `menuId` ordered by position.

## Files Modified

- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx`:
  - 5 new state variables: `menuProducts`, `imageSeedJobId`, `imageSeedPolling`, `imageSeedStatus`, `imageSeedProductLoading`.
  - New `useEffect` that fetches products from `/products-list` when `selectedMenuId` changes.
  - New `handleSeedImages(productId?)` function: POSTs to `/seed-images`, then polls `/seed-status?jobId=...` every 3000ms via `setInterval`. Polling stops on `complete` / `failed` / timeout (>100 polls). Network errors mid-poll continue silently.
  - New JSX subsection under AI Tools (after the existing Phase 9 per-item block):
    - `Seed all images` button (AI-07 + AI-08).
    - Per-product `Seed image` buttons or `has image` label (AI-09, skip-existing per D-09).
    - Polling pulse text + success/error banners, dismissible via `✕`.
  - Phase 9 text seeding UI (`handleSeed`, `handleSeedSingle`, `seedLoading`) and per-item block left untouched.

## Tasks & Commits

| Task | Description | Commit |
| ---- | ----------- | ------ |
| 1    | Create seed-images trigger + seed-status polling routes | `1f8e0bf` (already committed prior to this plan run; verified files match plan acceptance criteria exactly) |
| 2    | Create products-list endpoint + extend TenantDetailClient with image seeding UI | `c776999` |

Note on Task 1: Both route files were already on disk (created in `1f8e0bf` "feat: implement AI image seeding API endpoints"). On read, both files matched the plan's `<action>` blocks line-for-line and satisfied every item in `<acceptance_criteria>` (assertSuperadmin guard, runtime nodejs, maxDuration 15, ai_jobs insert, status !== 204 check, no `.json()` on dispatch, GH_PAT in Authorization header, image-seeding.yml workflow filename, returns `{ jobId }`; status route reads ai_jobs with tenant_id filter, returns `{ status, errorMessage }`, calls revalidatePath on complete). No re-commit needed.

## Acceptance Criteria Verification

Task 1 (re-verified):
- `seed-images/route.ts`: contains `assertSuperadmin()` 401 guard, `runtime = 'nodejs'`, `maxDuration = 15`, `from('ai_jobs').insert(`, `dispatchRes.status !== 204`, `process.env.GH_PAT`, `image-seeding.yml`, `return NextResponse.json({ jobId })`, does NOT contain `await dispatchRes.json()` (Pitfall 1 verified clean).
- `seed-status/route.ts`: contains `assertSuperadmin()`, `searchParams.get('jobId')`, `from('ai_jobs').select('status, error_message')`, `eq('tenant_id', tenantId)`, returns `{ status, errorMessage }`, calls `revalidatePath` on complete.

Task 2:
- `products-list/route.ts`: assertSuperadmin guard; returns `{ products: Array<{ id, name, image_url, category_id }> }`.
- TenantDetailClient: contains `handleSeedImages` function POSTing to `/seed-images`; `setInterval(..., 3000)` (D-08); `clearInterval` in complete/failed/timeout branches; timeout guard `polls > 100`; `'Seed all images'` button (AI-07); `'Seed image'` button in per-product loop (AI-09); `'has image'` label for products with truthy `image_url` (D-09); existing Phase 9 `seedLoading`/`handleSeed`/`handleSeedSingle` still present.
- `npm run build` exits 0 with `/api/superadmin/tenants/[id]/products-list` registered alongside `/seed-images` and `/seed-status` — no TypeScript errors, only a pre-existing Next.js workspace-root warning unrelated to this plan.

## Vercel Environment Variables Required

The trigger route depends on three Vercel env vars (NOT required to make `npm run build` pass — failure is surfaced at runtime as `500 GH Actions dispatch not configured`):

| Var | Purpose |
| --- | --- |
| `GH_PAT` | Fine-Grained PAT with `Actions:write` + `Workflows:write` on the repo (NOT `GITHUB_TOKEN` — Pitfall 2) |
| `GITHUB_REPO_OWNER` | e.g. `Vanildo` |
| `GITHUB_REPO_NAME` | e.g. `xmartmenu` |

`VERCEL_REVALIDATE_SECRET` (Plan 10-01) is referenced from the GH Actions side, not from these routes.

## Polling Configuration

- Interval: **3000 ms** (per CONTEXT D-08)
- Max polls: **100** → ~5 min timeout, after which a clear error banner is shown
- Polling clears on `status === 'complete'`, `status === 'failed'`, or timeout
- Mid-poll network errors are swallowed silently and polling continues

## AI-09 UI Approach

The per-product "Seed image" UI uses a new `products-list` endpoint (mirror of `categories-list`) instead of fetching products from inside the client component. Products with a non-null `image_url` show a `has image` label (AI-09 / D-09 skip-existing), products without show a `Seed image` button that calls `handleSeedImages(product.id)`. The list is constrained to `max-h-48 overflow-y-auto` so menus with many items don't blow out the AI Tools panel.

## Deviations from Plan

None. The two route files were already in place from prior partial work (commit `1f8e0bf`); they matched the plan exactly so they were re-verified against acceptance criteria rather than rewritten. The products-list endpoint and TenantDetailClient extension were implemented as specified in the plan's `<action>` blocks.

## Self-Check: PASSED

- File exists: `src/app/api/superadmin/tenants/[id]/seed-images/route.ts` (FOUND)
- File exists: `src/app/api/superadmin/tenants/[id]/seed-status/route.ts` (FOUND)
- File exists: `src/app/api/superadmin/tenants/[id]/products-list/route.ts` (FOUND, new)
- File modified: `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` (FOUND, contains handleSeedImages + image seed JSX section + 5 new state vars)
- Commit `c776999` (FOUND in `git log`)
- Commit `1f8e0bf` (FOUND in `git log` — contains seed-images + seed-status routes)
- `npm run build` exits 0 with `/api/superadmin/tenants/[id]/products-list` registered as a route (verified)
