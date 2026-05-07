---
phase: 10-image-seeding
plan: 01
subsystem: ai-image-seeding
tags: [foundation, supabase-migration, types, dependency, revalidation]
requires:
  - tenants table (existing)
  - profiles.role column (existing)
  - VERCEL_REVALIDATE_SECRET env var (must be set in Vercel + GH Actions before Wave 2)
provides:
  - ai_jobs table (DDL — application pending in Supabase SQL editor)
  - AiJob TypeScript interface
  - "@google/genai@1.52.0 dependency"
  - POST /api/revalidate endpoint
affects:
  - supabase/migrations/023_ai_jobs.sql
  - src/types/database.ts
  - src/app/api/revalidate/route.ts
  - package.json
  - package-lock.json
tech_stack:
  added:
    - "@google/genai@1.52.0"
  patterns:
    - RLS policy gated by profiles.role = 'superadmin' (matches migration 022)
    - "IF NOT EXISTS / DO $$ BEGIN ... END $$ idempotent migration pattern"
    - Internal HTTP endpoint with shared-secret auth (Pattern 8 — GH Actions → Next.js cache invalidation)
key_files:
  created:
    - supabase/migrations/023_ai_jobs.sql
    - src/app/api/revalidate/route.ts
  modified:
    - src/types/database.ts
    - package.json
    - package-lock.json
decisions:
  - "ai_jobs.status modeled as TEXT with TS union type 'pending' | 'running' | 'complete' | 'failed' (no DB CHECK constraint — TS layer enforces; matches Order.status pattern)"
  - "revalidate route uses shared-secret pattern (process.env.VERCEL_REVALIDATE_SECRET) — GH Actions cannot call revalidatePath directly"
  - "runtime='nodejs' on revalidate route to match all other AI/Sharp routes (Edge runtime not viable for downstream consumers)"
metrics:
  duration_min: 5
  tasks_completed: 2
  files_changed: 5
  completed_at: "2026-05-07"
---

# Phase 10 Plan 01: Image Seeding Foundation Summary

Foundational infrastructure landed: the `ai_jobs` table DDL, the `AiJob` TypeScript type, the `@google/genai` dependency, and the internal `/api/revalidate` endpoint that GH Actions will hit after Wave 2 image uploads complete.

## Files Created / Modified

| File | Change | Notes |
| ---- | ------ | ----- |
| `supabase/migrations/023_ai_jobs.sql` | created | DDL for `ai_jobs` table + `ai_jobs_superadmin` RLS policy |
| `src/types/database.ts` | modified | Added `export interface AiJob` directly after `AiUsage` |
| `src/app/api/revalidate/route.ts` | created | POST endpoint, secret-gated, calls `revalidatePath()` |
| `package.json` | modified | Added `"@google/genai": "^1.52.0"` |
| `package-lock.json` | modified | Lockfile updated by `npm install` |

## @google/genai Version

Confirmed: `"@google/genai": "^1.52.0"` in `package.json` line 15. `npm install` reported `added 480 packages` (transitive deps). Resolved version: 1.52.0 (constraint matches plan).

## Migration 023 Status

**PENDING — must be applied in Supabase SQL editor** (local Supabase Docker is not available in this project — same workflow as migration 022).

Apply by running the contents of `supabase/migrations/023_ai_jobs.sql` in the Supabase SQL editor for the production project. The migration is idempotent (`IF NOT EXISTS` everywhere), so it is safe to re-run.

After application, confirm via:
```sql
SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'ai_jobs' ORDER BY ordinal_position;
SELECT policyname FROM pg_policies WHERE tablename = 'ai_jobs';
```

Expected columns: `id, tenant_id, feature_key, status, created_at, completed_at, error_message`. Expected policy: `ai_jobs_superadmin`.

## AiJob Interface — Exact Status Union

```typescript
export interface AiJob {
  id: string
  tenant_id: string
  feature_key: string                                    // e.g. 'image_seeding', 'image_single'
  status: 'pending' | 'running' | 'complete' | 'failed'
  created_at: string
  completed_at: string | null
  error_message: string | null
}
```

Status union exact: `'pending' | 'running' | 'complete' | 'failed'`. `completed_at` and `error_message` are nullable per DDL (no `NOT NULL` on those columns).

## Revalidate Endpoint

| Property | Value |
| -------- | ----- |
| URL | `POST /api/revalidate` |
| Runtime | `nodejs` |
| Secret env var | `VERCEL_REVALIDATE_SECRET` |
| Body shape | `{ secret: string, tenantSlug: string, menuSlug?: string }` |
| Success response | `{ revalidated: true, tenantSlug }` (200) |
| Error responses | `401 Unauthorized` (bad/missing secret), `400` (missing tenantSlug) |

`VERCEL_REVALIDATE_SECRET` must be set in:
1. **Vercel** project env vars (Production + Preview)
2. **GitHub Actions** repository secrets (so the Wave 2 workflow can include it in the POST body)

Generate any secure random value, e.g.: `openssl rand -hex 32`.

## Verification Performed

| Check | Result |
| ----- | ------ |
| `grep "CREATE TABLE IF NOT EXISTS ai_jobs"` migration | found at line 7 |
| `grep "ai_jobs_superadmin"` migration | found at lines 21 + 23 |
| `grep "TEXT NOT NULL DEFAULT 'pending'"` migration | found at line 11 |
| `grep "AiJob"` types | `export interface AiJob` found at line 167 |
| `grep "@google/genai"` package.json | found at line 15 |
| `grep "VERCEL_REVALIDATE_SECRET"` route | found at line 19 |
| `grep "export const runtime = 'nodejs'"` route | found at line 8 |
| `grep "revalidatePath(\`/\${tenantSlug}\`)"` route | found at line 27 |
| `npm run build` | exit code 0 — `/api/revalidate` listed in route table (`ƒ /api/revalidate`) |

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed without auto-fix or architectural deviation.

## Authentication Gates

None. Migration application is a normal GSD workflow step (documented in `<action>` of Task 1) and not an auth gate.

## Known Stubs

None. The route reads body, validates secret, and calls `revalidatePath()` — no placeholder data, no UI components, no empty-array fallbacks.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 | `d906844` | feat(10-01): add ai_jobs migration 023 and AiJob TypeScript type |
| 2 | `95abf38` | feat(10-01): install @google/genai and add internal revalidate endpoint |

## Follow-ups for Wave 2 / Wave 3

- Apply migration 023 in Supabase SQL editor before any code attempts to insert into / update `ai_jobs`.
- Set `VERCEL_REVALIDATE_SECRET` in Vercel env vars and GitHub repo secrets before the GH Actions workflow runs (Wave 2 plan: 10-02 trigger route + Wave 3 plan: 10-03 GH Actions script).
- Plans 10-02 (trigger route inserts `ai_jobs` row) and 10-03 (GH Actions script updates `ai_jobs.status` and POSTs to `/api/revalidate`) can now reference these primitives.

## Self-Check: PASSED

All five files exist on disk and both per-task commits are in the git log:

- supabase/migrations/023_ai_jobs.sql — FOUND
- src/app/api/revalidate/route.ts — FOUND
- src/types/database.ts — FOUND (modified)
- package.json — FOUND (modified)
- .planning/phases/10-image-seeding/10-01-SUMMARY.md — FOUND
- commit d906844 — FOUND
- commit 95abf38 — FOUND
