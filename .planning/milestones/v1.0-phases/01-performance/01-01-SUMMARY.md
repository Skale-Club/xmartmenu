---
phase: 01-performance
plan: "01"
subsystem: public-menu-routes
tags: [performance, isr, caching, react-cache, parallel-fetch]
dependency_graph:
  requires: []
  provides: [isr-public-routes, react-cache-tenant-dedup, parallel-tenant-menu-fetch]
  affects: [src/app/page.tsx, "src/app/(public)/[slug]/page.tsx", "src/app/(public)/[slug]/[menuSlug]/page.tsx"]
tech_stack:
  added: []
  patterns: [react-cache, isr-revalidate, promise-all-parallel-fetch]
key_files:
  modified:
    - src/app/page.tsx
    - src/app/(public)/[slug]/page.tsx
    - src/app/(public)/[slug]/[menuSlug]/page.tsx
decisions:
  - "React cache() wraps getTenantBySlug at module level so generateMetadata and the page function share one DB call per request"
  - "Promise.all parallelizes tenant + menu fetch in [slug]/[menuSlug] — saves 1 serial DB round-trip per QR scan"
  - "revalidate=60 chosen for public routes — menus change rarely, 60s staleness acceptable"
  - "createServiceClient() is synchronous — removed erroneous await from original code"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-05-05"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
---

# Phase 1 Plan 01: ISR Caching and Query Deduplication on Public Menu Routes

ISR revalidate=60 with React cache() deduplication and parallel tenant+menu fetch on all public QR-scan menu pages.

## What Was Built

Three source files were modified to eliminate force-dynamic rendering and add ISR caching with two query optimizations:

1. **src/app/page.tsx** — Removed `export const dynamic = 'force-dynamic'`. The root page only redirects to `/auth/login` with no data fetching, so it is now statically generated at build time and served from CDN edge.

2. **src/app/(public)/[slug]/page.tsx** — Replaced force-dynamic with `export const revalidate = 60`. Added `import { cache } from 'react'` and extracted a module-level `getTenantBySlug` function wrapped in `cache()`. Both `generateMetadata` and the page function call `getTenantBySlug(slug)`, but React deduplicates the call — only 1 tenant DB query fires per request instead of 2.

3. **src/app/(public)/[slug]/[menuSlug]/page.tsx** — Same revalidate=60 and getTenantBySlug cache() pattern. Added parallel fetch: `Promise.all([getTenantBySlug(slug), supabase.from('menus')...])` in both `generateMetadata` and the page function. Cross-validates `menuCandidate.tenant_id === tenant.id` to prevent a menu slug from one tenant being served under another tenant's slug. Categories + products remain parallel (already was).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 8265ea1 | perf(01-01): remove force-dynamic from root page |
| 2 | 911be66 | perf(01-01): add ISR revalidate=60 and React cache() to /[slug] page |
| 3 | 3e0e554 | perf(01-01): add ISR revalidate=60, React cache(), and parallel fetch to /[slug]/[menuSlug] page |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed erroneous `await` before synchronous createServiceClient()**
- **Found during:** Reading existing code for Task 2 and Task 3
- **Issue:** Original files used `const supabase = await createServiceClient()` but `createServiceClient()` is a plain synchronous function (not async, returns client directly). The await was silently harmless but incorrect.
- **Fix:** Changed to `const supabase = createServiceClient()` throughout the modified files, matching the actual function signature.
- **Files modified:** src/app/(public)/[slug]/page.tsx, src/app/(public)/[slug]/[menuSlug]/page.tsx
- **Commit:** Included in commits 911be66 and 3e0e554

## Build Verification

`npm run build` exits with code 0. Route output:
- `/` shows `○ (Static)` — confirmed statically generated
- `/[slug]` and `/[slug]/[menuSlug]` show `ƒ (Dynamic)` — this is expected for Next.js 16 ISR routes with dynamic segments that don't use `generateStaticParams`. The `revalidate=60` export is active; routes are rendered on demand and cached for 60 seconds (ISR behavior).

TypeScript compilation: `npx tsc --noEmit` exits with code 0, no errors.

## Known Stubs

None.

## Self-Check: PASSED

- src/app/page.tsx: exists, no force-dynamic, has redirect
- src/app/(public)/[slug]/page.tsx: exists, has revalidate=60, has getTenantBySlug = cache, 2 calls to getTenantBySlug(slug)
- src/app/(public)/[slug]/[menuSlug]/page.tsx: exists, has revalidate=60, has getTenantBySlug = cache, 3 Promise.all calls, cross-validation guard
- Commits 8265ea1, 911be66, 3e0e554 verified in git log
