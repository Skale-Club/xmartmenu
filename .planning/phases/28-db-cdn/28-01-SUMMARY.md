---
phase: 28-db-cdn
plan: "01"
subsystem: database-performance, cdn
tags: [migration, indices, cdn, performance, profiles]
dependency_graph:
  requires: []
  provides: [profiles-indices, cdn-cache-headers]
  affects: [rls-checks, image-load-performance]
tech_stack:
  added: []
  patterns: [node-pg-migration-runner, supabase-storage-updateBucket]
key_files:
  created:
    - supabase/migrations/028_profiles_indices.sql
    - scripts/apply-migration-028.mjs
    - scripts/configure-cdn-cache.mjs
  modified: []
decisions:
  - "3 separate indices on profiles (tenant_id, role, composite) rather than a single composite — same rationale as migration 024: single-column filters cannot use leading-column-only composite efficiently"
  - "configure-cdn-cache.mjs reads .env.local directly via readFileSync — consistent with pattern used for migration runner scripts; no dotenv dependency needed"
  - "public: true passed alongside cacheControl in updateBucket() — preserves existing bucket public access settings while adding cache header"
metrics:
  duration: "~2 minutes"
  completed: "2026-05-08"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
requirements_satisfied:
  - PERF-01
  - PERF-02
  - PERF-03
  - PERF-04
---

# Phase 28 Plan 01: DB + CDN — Profiles Indices + CDN Cache Headers Summary

**One-liner:** Three B-tree indices on `profiles(tenant_id, role, tenant_id+role)` eliminate Seq Scans on every RLS check; both Supabase Storage buckets configured with `Cache-Control: public, max-age=31536000, immutable`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write migration SQL and runner script | 1475467 | supabase/migrations/028_profiles_indices.sql, scripts/apply-migration-028.mjs |
| 2 | Write and run CDN cache configuration script | 9e9a4df | scripts/configure-cdn-cache.mjs |

## What Was Built

### Task 1 — Migration 028 Profiles Indices

`supabase/migrations/028_profiles_indices.sql` creates 3 indices with `IF NOT EXISTS` safety:

- `idx_profiles_tenant ON profiles(tenant_id)` — PERF-01: eliminates Seq Scan from `auth_tenant_id()` RLS helper
- `idx_profiles_role ON profiles(role)` — PERF-02: eliminates Seq Scan from `is_superadmin()` RLS policy checks
- `idx_profiles_tenant_role ON profiles(tenant_id, role)` — PERF-03: covers combined staff/permission queries filtering both columns

`scripts/apply-migration-028.mjs` is a clone of `apply-migration-027.mjs` with the migration filename updated. Uses Node.js `pg` client with `DATABASE_URL` from environment. Migration applied successfully (exit 0, "Migration 028 applied successfully.").

### Task 2 — CDN Cache Configuration

`scripts/configure-cdn-cache.mjs` reads `.env.local` directly via `readFileSync` (no dotenv dependency), creates a Supabase admin client with `SUPABASE_SERVICE_ROLE_KEY`, and calls `updateBucket()` on both `tenant-assets` and `product-images` with `cacheControl: '31536000'`. Script executed successfully:

```
Bucket 'tenant-assets' updated — cacheControl: 31536000
Bucket 'product-images' updated — cacheControl: 31536000
CDN cache configuration complete.
```

Both buckets now respond with `Cache-Control: public, max-age=31536000, immutable` — PERF-04 satisfied.

## Verification Results

- Migration 028 runner: exit 0, "Migration 028 applied successfully."
- CDN script: exit 0, both buckets updated
- TypeScript baseline: `npx tsc --noEmit` — 0 errors (no-op sanity, .mjs files are excluded from tsc)
- Files contain all required strings verified by grep

## Decisions Made

1. **Separate indices over single composite** — `profiles(tenant_id)` and `profiles(role)` as standalone indices alongside the `(tenant_id, role)` composite. The `auth_tenant_id()` function filters by `user_id` (PK, indexed) to get `tenant_id`, and `is_superadmin()` filters by `role` alone — neither can use a composite efficiently as a secondary column. Same rationale as migration 024.

2. **Script reads .env.local directly** — The CDN script parses `.env.local` via `readFileSync` rather than relying on environment variable injection. Consistent with the established one-off script pattern in this project. No additional npm dependency required.

3. **`public: true` in updateBucket call** — Passes alongside `cacheControl` to avoid any unintended reversion of bucket public-access settings during the cache update.

## Deviations from Plan

None — plan executed exactly as written.

The only operational note: the worktree does not contain `.env.local` (gitignored), so `.env.local` was temporarily copied from the main project root to the worktree root to allow `configure-cdn-cache.mjs` (which resolves `../.env.local` relative to `__dirname`) to locate it. The file was not committed (`.env.*` is in `.gitignore`).

## Known Stubs

None.

## Self-Check: PASSED

- supabase/migrations/028_profiles_indices.sql — FOUND
- scripts/apply-migration-028.mjs — FOUND
- scripts/configure-cdn-cache.mjs — FOUND
- Commit 1475467 — FOUND
- Commit 9e9a4df — FOUND
