---
phase: 35-custom-domain
plan: 01
subsystem: infra, ui, middleware
tags: custom-domain, dns, middleware, migration, dns-verification

# Dependency graph
requires: []
provides:
  - Custom domain support: tenants can serve menu from their own domain (CNAME to xmartmenu.skale.club)
  - Middleware hostname-based tenant resolution with in-memory cache
  - DNS verification endpoint with CNAME and A record checking
  - Superadmin force-verify bypass for domain activation
  - Store settings UI for custom domain input and DNS instructions
affects: [public-menu-routing, superadmin-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Inline middleware tenant resolution with Map-based TTL cache (60s)
    - DNS verification with dual strategy: CNAME match or A record overlap (Vercel IP rotation-safe)
    - pg.Client pattern for migration scripts (consistent with 032+)
    - Service client used for DB updates in API routes (no RLS dependency)

key-files:
  created:
    - supabase/migrations/031_custom_domain.sql (actual file, plan specified 029)
  modified:
    - scripts/apply-migration-029.mjs (fixed to use pg pattern, reference 031)
    - src/middleware.ts (custom domain hostname resolution)
    - src/types/database.ts (custom_domain + custom_domain_verified fields)
    - src/app/(admin)/settings/store/StoreClient.tsx (custom domain UI + DNS instructions)
    - src/app/api/admin/tenants/[id]/route.ts (PATCH handler for custom_domain)
    - src/app/api/admin/tenants/[id]/verify-domain/route.ts (DNS verification + force bypass)

key-decisions:
  - Migration numbered 031 (not 029) because 029_english_first_defaults.sql and 030_plans_subscriptions.sql already existed at plan creation time
  - Middleware resolves tenant inline via resolveTenantSlugFromHost() instead of a separate lib file — keeps Edge runtime imports minimal
  - DNS verification uses dual strategy: CNAME match or A record IP overlap (Vercel rotates IPs, so single-IP equality check would be brittle)
  - Superadmin force-verify uses assertSuperadmin() — consistent with existing SEC-03 pattern across all admin routes
  - custom_domain_verified flag gates middleware rewrite: only verified domains get routed

patterns-established:
  - Inline middleware custom domain resolve with TTL cache to avoid per-request DB hits
  - DNS verification with CNAME (preferred) and A record overlap (fallback) for Vercel-deployed custom domains

requirements-completed:
  - DOM-01.1 (custom_domain column on tenants)
  - DOM-01.2 (middleware hostname resolution)
  - DOM-01.3 (admin UI for domain input)
  - DOM-01.4 (DNS instructions display)
  - DOM-01.5 (URL rewrite / slug bypass)
  - DOM-01.6 (DNS verification endpoint)

# Metrics
duration: 2min
completed: 2026-05-22
---

# Phase 35: Custom Domain — Plan 01 Summary

**Custom domain infrastructure: migration, middleware hostname resolution, admin UI, DNS verification, and superadmin force-bypass**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-22T05:45:40Z
- **Completed:** 2026-05-22T05:48:03Z
- **Tasks:** 6 (Tasks 2-5 were pre-existing in codebase)
- **Files modified:** 2 (scripts, verify-domain route)

## Accomplishments

- Verified and documented that all 6 plan tasks are complete in the codebase
- Fixed `scripts/apply-migration-029.mjs` to use pg.Client pattern (consistent with 032+ scripts) and reference the correct migration file (`031_custom_domain.sql`)
- Added `force: true` superadmin bypass to the DNS verification endpoint (was missing from the original implementation)
- All acceptance criteria verified: migration exists at 031, middleware rewrites custom domains, StoreClient has domain input + DNS instructions, verification endpoint works

## Task Completion

This plan was found to be **largely already implemented** as part of the v2.1 Custom Domains release. The key structural difference:

| Plan Spec | Actual Codebase |
|-----------|----------------|
| Migration `029_custom_domain.sql` | `031_custom_domain.sql` (029 was taken by English defaults) |
| Separate `resolve-tenant-from-host.ts` | Logic inline in `middleware.ts` (Edge-friendly) |
| Separate `verify-domain-dns.ts` | Logic inline in `verify-domain/route.ts` |

## Task Commits

Each task was committed atomically:

1. **Task 1: DB Migration** — Pre-existing (`031_custom_domain.sql`). Fixed script in `b191d3f`.
2. **Task 2: Middleware** — Pre-existing in `src/middleware.ts`. No changes needed.
3. **Task 3: Admin UI** — Pre-existing in `StoreClient.tsx`. No changes needed.
4. **Task 4: DNS Instructions** — Pre-existing in `StoreClient.tsx`. No changes needed.
5. **Task 5: Slug Bypass** — Pre-existing in `middleware.ts`. No changes needed.
6. **Task 6: Domain Validation** — Pre-existing verify-domain route. Added `force` superadmin bypass in `de8dc17`.

### Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DB Migration (script fix) | `b191d3f` | `scripts/apply-migration-029.mjs` |
| 6 | Superadmin force bypass | `de8dc17` | `src/app/api/admin/tenants/[id]/verify-domain/route.ts` |

## Files Modified

- `scripts/apply-migration-029.mjs` — Rewritten to use pg.Client pattern (matching 032+ scripts). References `031_custom_domain.sql` instead of non-existent `029_custom_domain.sql`.
- `src/app/api/admin/tenants/[id]/verify-domain/route.ts` — Added `force: true` superadmin bypass. Uses `assertSuperadmin()` for auth check.

### Pre-existing Key Files (already in codebase)

- `supabase/migrations/031_custom_domain.sql` — Adds `custom_domain TEXT` + `custom_domain_verified BOOLEAN DEFAULT false` columns, unique constraint, and partial index.
- `src/middleware.ts` — Inline `resolveTenantSlugFromHost()` with Map-based TTL cache. Rewrites custom domain requests to tenant slug path. Double-rewrite prevention. Only routes verified domains.
- `src/types/database.ts` — `Tenant` interface has `custom_domain: string | null` and `custom_domain_verified: boolean`.
- `src/app/(admin)/settings/store/StoreClient.tsx` — "Custom Domain" section with input field, "Save Domain" button, "Verify DNS" button, DNS instructions CNAME block, verification result feedback.
- `src/app/api/admin/tenants/[id]/route.ts` — PATCH handler accepts `custom_domain`, resets `custom_domain_verified` to false on update.
- `src/app/api/admin/tenants/[id]/verify-domain/route.ts` — DNS verification: checks CNAME match, A record overlap, or superadmin force bypass.

## Decisions Made

- **Migration at 031, not 029:** The plan specified `029_custom_domain.sql` but `029_english_first_defaults.sql` and `030_plans_subscriptions.sql` already existed. The actual migration was correctly placed at 031.
- **Inline middleware, no separate lib:** `resolveTenantSlugFromHost()` lives directly in `middleware.ts` to keep Edge Runtime imports minimal. No `resolve-tenant-from-host.ts` was created — equivalent to the plan intent.
- **DNS verification dual strategy:** Accepts CNAME (preferred) or A record IP overlap (Vercel rotates IPs so single-IP equality is brittle).
- **Verification gates routing:** Middleware only rewrites requests for tenants with `custom_domain_verified = true`, preventing activation before DNS propagates.

## Deviations from Plan

### File Numbering Differences

| Plan Specified | Actual | Reason |
|----------------|--------|--------|
| `supabase/migrations/029_custom_domain.sql` | `supabase/migrations/031_custom_domain.sql` | 029 and 030 already existed from prior phases |
| `src/lib/resolve-tenant-from-host.ts` | Logic inline in `src/middleware.ts` | Edge-friendly — avoids extra import in Edge Runtime |
| `src/lib/verify-domain-dns.ts` as separate lib | Logic inline in `verify-domain/route.ts` | Self-contained route — no reusability need identified |

All of these are equivalent in functionality. No behavior is lost.

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Superadmin force-verify bypass not implemented**
- **Found during:** Task 6 verification review
- **Issue:** The plan specified superadmin can force-activate domains via `force: true`, but the original verify-domain endpoint had no such feature
- **Fix:** Added `force: true` parameter support — checks `assertSuperadmin()` and sets `custom_domain_verified = true` without DNS check
- **Files modified:** `src/app/api/admin/tenants/[id]/verify-domain/route.ts`
- **Committed in:** `de8dc17`

**2. [Rule 2 - Missing Critical] Migration script referenced non-existent file**
- **Found during:** Task 1 execution
- **Issue:** `scripts/apply-migration-029.mjs` used a fetch-based SQL execution pattern (inconsistent with all 032+ scripts) and referenced `029_custom_domain.sql` which doesn't exist
- **Fix:** Rewrote to use `pg.Client` pattern (consistent with 032+ scripts). Changed reference to `031_custom_domain.sql`.
- **Files modified:** `scripts/apply-migration-029.mjs`
- **Committed in:** `b191d3f`

---

**Total deviations:** 2 auto-fixed (both missing critical)
**Impact on plan:** Auto-fixes necessary for correctness and consistency. No scope creep.

## Issues Encountered

None — all planned functionality was already implemented. The two fixes were minor corrections.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Custom domain infrastructure is complete and production-ready (shipped as v2.1 on 2026-05-10)
- Phase 36 (English Conversion) can proceed as planned
- No blockers for subsequent plans

---

*Phase: 35-custom-domain*
*Completed: 2026-05-22*
