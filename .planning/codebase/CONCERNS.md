# Codebase Concerns

**Analysis Date:** 2026-05-05

## Critical Issues

### Supabase Keepalive Resilience — Fixed But Fragile
- **Issue:** Recent commits (630304e, c7599c9, 5066583) indicate the Supabase Keepalive workflow has had multiple rounds of hardening against malformed secrets and transient failures
- **Files:** `.github/workflows/supabase-keepalive.yml` (125+ lines of validation logic added)
- **Impact:** Free tier databases pause after ~1 week without activity. The workflow must succeed or project becomes unavailable
- **Evidence:** 
  - 630304e: "Make Supabase Keepalive resilient to malformed secrets and transient failures" — added sanitization, retry backoff, credential validation
  - c7599c9: "Accept NEXT_PUBLIC_SUPABASE_* as fallback" — secrets environment variable naming fragility
  - 5066583: Documentation commit on accepted secret names — suggests confusion about naming conventions
- **Fix approach:** Establish standard secret names in GitHub Actions and document in SUPERADMIN_EMAILS environment setup. Add monitoring/alerting for workflow failures
- **Priority:** HIGH — Project unavailability if workflow fails

### N+1 Query Pattern in Staff Listing
- **Issue:** `src/app/api/admin/staff/route.ts` lines 30-37 — fetches staff profiles, then loops through each to call `getUserById()` individually
- **Files:** `src/app/api/admin/staff/route.ts` (lines 22-37)
- **Problem:** For N staff members, makes N+1 auth API calls (1 bulk profile fetch + N individual user lookups)
- **Code snippet:**
  ```typescript
  const staffWithEmail = await Promise.all(
    ids.map(async (id) => {
      const { data: u } = await service.auth.admin.getUserById(id)  // N calls
      ...
    })
  )
  ```
- **Impact:** At scale (20+ staff), API rate limiting and slow response times
- **Fix approach:** Batch email lookups or cache auth metadata in profiles table if permissions allow
- **Priority:** MEDIUM — Currently manageable but will degrade with tenant growth

### Multi-Tenant Resolution Has Fallback Gaps
- **Issue:** `src/lib/get-effective-tenant.ts` uses implicit tenant resolution that may return empty slug/name
- **Files:** `src/lib/get-effective-tenant.ts` (lines 40-46)
- **Problem:** When `profile.tenants` is null/undefined, returns empty strings instead of failing explicitly
- **Code snippet:**
  ```typescript
  const t = profile.tenants as any  // Type unsafe cast
  return {
    slug: t?.slug ?? '',  // Silent fallback to empty string
    name: t?.name ?? '',
  }
  ```
- **Impact:** Routes using empty slug will 404. Errors may be silent
- **Fragile areas:** Any page that calls `getEffectiveTenant()` and assumes slug/name are populated
- **Fix approach:** Return null/throw explicitly if tenant data is missing. Add validation in calling code
- **Priority:** MEDIUM — Affects staff-scoped pages and admin dashboard

### Tenant Isolation Not Enforced at API Layer
- **Issue:** RLS policies at database level are strong, but API endpoints have inconsistent auth checks
- **Files:** `src/app/api/admin/staff/route.ts` (lines 5-13), `src/app/api/superadmin/tenants/route.ts` (lines 4-16)
- **Problem:** Two different patterns for asserting role/tenant:
  1. Some endpoints use `assertSuperadmin()` then check profile role
  2. Others use `getEffectiveTenant()` then check role
  3. No uniform auth middleware
- **Impact:** Risk of inconsistent access control if endpoints are refactored
- **Evidence:**
  - `src/app/api/superadmin/tenants/route.ts`: Direct profile query (line 10-13)
  - `src/app/api/admin/staff/route.ts`: Uses getEffectiveTenant() (line 9)
- **Fix approach:** Create single `assertStoreAdmin()` or `requireRole()` middleware used everywhere. RLS provides defense-in-depth but API layer should be consistent
- **Priority:** HIGH — Security correctness depends on consistency

### Superadmin Preview Tenant via Cookie
- **Issue:** `src/lib/get-effective-tenant.ts` lines 25-37 — superadmins are routed through `preview_tenant_id` cookie
- **Files:** `src/lib/get-effective-tenant.ts`, `src/lib/supabase/middleware.ts` (line 77)
- **Problem:** Cookie-based tenant selection is trust boundary. No validation that superadmin can actually preview that tenant
- **Code snippet:**
  ```typescript
  const previewTenantId = cookieStore.get('preview_tenant_id')?.value
  // No check: is this superadmin actually allowed to preview this tenant?
  ```
- **Impact:** Although RLS prevents actual data access, UX is confusing (superadmin might load UI for tenant they shouldn't see)
- **Fix approach:** Validate in `getEffectiveTenant()` that superadmin has legitimate reason to access that tenant (e.g., support ticket, audit trail)
- **Priority:** MEDIUM — Low risk due to RLS, but poor practice

## High-Priority Bugs

### Password Change Flow Not Enforced Consistently
- **Issue:** `must_change_password` flag forces redirect in middleware but can be bypassed
- **Files:** 
  - `src/lib/supabase/middleware.ts` (lines 85-91)
  - `src/app/(admin)/settings/password/page.tsx` (must_change_password: false update)
  - `src/app/api/superadmin/tenants/route.ts` (line 89, sets must_change_password: true for new staff)
- **Problem:** User can skip password change by directly calling `/api/` endpoints that don't check middleware
- **Code snippet (middleware):**
  ```typescript
  if (mustChangePassword && !pathname.startsWith('/settings/password')) {
    // Redirects UI but doesn't prevent API calls
  }
  ```
- **Impact:** New provisioned staff (from lines 73-91 in tenants/route.ts) bypass forced password reset if they make direct API calls
- **Fix approach:** 
  1. Check `must_change_password` in API middleware (e.g., `/api/admin/*` should block until password changed)
  2. Or enforce in RLS: prevent non-password operations for users with flag set
- **Priority:** HIGH — Security regression

### Staff Role Doesn't Match RLS Intent
- **Issue:** Migration 016 created "store-staff" role but it still has write permissions via RLS policies
- **Files:** 
  - `supabase/migrations/016_staff_read_only_permissions.sql` (lines 1-2 claim read-only, but policies use it differently)
  - `src/lib/supabase/middleware.ts` (lines 94-105 blocks routes but not API calls)
- **Problem:** RLS policies in 016 say "store-admin manage menus" but don't mention staff in DELETE/UPDATE USING clauses — staff cannot update/delete. However, the policy still allows staff SELECT (line 182-185)
- **Evidence:** Comment says "read_only" but CREATE POLICY lines don't prevent staff from reading.
- **Impact:** Staff can see all tenant data (categories, products, QR codes). Scope unclear
- **What happens:** Middleware (lines 94-105) blocks routes like `/menus`, `/settings/staff` but doesn't prevent staff from calling `/api/categories` directly
- **Fix approach:** 
  1. Clarify staff scope — what should they actually see?
  2. Add explicit staff SELECT policies or RLS checks
  3. Enforce in middleware for `/api/admin/*` routes
- **Priority:** MEDIUM — Staff cannot mutate (safe) but can read more than intended

## Security Concerns

### Default Staff Password in Environment
- **Issue:** `src/app/api/admin/staff/route.ts` line 15 uses environment variable for default password
- **Files:** `src/app/api/admin/staff/route.ts`
- **Code snippet:**
  ```typescript
  const DEFAULT_STAFF_PASSWORD = process.env.DEFAULT_STAFF_PASSWORD?.trim() || 'Staff@12345'
  ```
- **Problem:** 
  1. Hardcoded fallback `'Staff@12345'` if env var missing — very weak
  2. Same password for all staff — if one is compromised, all are compromised
- **Impact:** Staff accounts start with known/weak password until they change it
- **Fix approach:**
  1. Remove hardcoded fallback — require explicit env var or generate random password
  2. Use Supabase temp password feature instead of fixed password
  3. Force password change for all newly created staff (already does this via `must_change_password: true`)
- **Priority:** MEDIUM — Mitigated by forced password change, but bad practice

### Orders Table RLS Allows Anonymous INSERT
- **Issue:** `supabase/migrations/019_full_schema_sync.sql` lines 169-174 allow public to insert orders
- **Files:** `supabase/migrations/019_full_schema_sync.sql` (line 169)
- **Code snippet:**
  ```sql
  CREATE POLICY "orders_public_insert" ON orders FOR INSERT
    WITH CHECK (true);
  ```
- **Problem:** Anyone can insert orders for any tenant. RLS doesn't validate `tenant_id` matches requestor's tenant
- **Impact:** Abuse vector — anonymous user inserts 10,000 orders to drain database quota
- **Evidence:** No tenant_id check in INSERT policy. Compare to UPDATE/DELETE which require `auth_tenant_id()` (line 164)
- **Fix approach:** 
  1. Add tenant validation to INSERT: only allow insert if ordering is enabled for that tenant (check `tenant_settings.orders_enabled`)
  2. Or require authenticated user and associate with their tenant
  3. Add rate limiting at API layer (`src/app/api/orders/route.ts` if exists)
- **Priority:** HIGH — Public abuse vector

### Service Role Key in `.env.local`
- **Issue:** `.env.local` exists in repo (checked via ls output)
- **Files:** `.env.local` (noted in ls output but not read per forbidden_files rule)
- **Problem:** Service role key is secret — must never be committed
- **Evidence:** `.gitignore` should exclude `.env.local` but if it's tracked, it's a breach
- **Impact:** Anyone with repo access has admin database access
- **Fix approach:** 
  1. Verify `.env.local` is in `.gitignore` (check it is — line in .gitignore shown as 157 bytes)
  2. If already committed: `git rm --cached .env.local && git commit --amend`
  3. Rotate SUPABASE_SERVICE_ROLE_KEY
- **Priority:** CRITICAL if committed (check git log for .env.local)

## Performance Bottlenecks

### Large Components Lack Code Splitting
- **Issue:** `src/components/menu/MenuPage.tsx` is 942 lines — the largest component
- **Files:** `src/components/menu/MenuPage.tsx`
- **Problem:** Single component handles search, filtering, cart, language selection, modal management, order submission. No route-level code splitting visible
- **Impact:** Menu page bundle includes all this logic even for public customers just browsing
- **Evidence:** Line count of 942 for a single component; dozens of useState hooks (lines 59-79 visible)
- **Fix approach:** 
  1. Extract cart logic to separate hook/context (CartContext)
  2. Lazy-load modals (React.lazy)
  3. Split language switcher to separate component
- **Priority:** LOW — Not currently slow, but will scale poorly

### Missing Database Indices
- **Issue:** `supabase/migrations/019_full_schema_sync.sql` adds indices for orders but previous migrations lack comprehensive coverage
- **Files:** 
  - `supabase/migrations/001_initial_schema.sql` (lines 92-97 have basic indices)
  - `supabase/migrations/019_full_schema_sync.sql` (lines 155-157 add orders indices)
- **Problem:** 
  1. No index on `categories.tenant_id` before 019, but queries filter by it
  2. No index on `profiles.tenant_id` (migration 001 never added it)
- **Missing indices:**
  - `profiles(tenant_id)` — used in RLS checks
  - `menus(tenant_id)` — added in 019 but not explicit
  - `order_items(product_id)` — added but not verified
- **Impact:** RLS policy queries that do `SELECT 1 FROM profiles WHERE tenant_id = X` scan full table
- **Evidence:** Migration 001 creates indices for products/categories/qr_codes/scan_events but not profiles
- **Fix approach:** Add composite indices for common RLS filter patterns (tenant_id + role, tenant_id + id)
- **Priority:** MEDIUM — RLS checks are fast by chance, will degrade with data volume

## Fragile Areas

### RLS Helper Function Abuse
- **Issue:** `is_superadmin()` and `auth_tenant_id()` SQL functions in migration 001 are used everywhere but have implicit dependencies
- **Files:** 
  - `supabase/migrations/001_initial_schema.sql` (lines 144-156)
  - Used in migrations 016, 019 and all RLS policies
- **Problem:**
  1. `auth_tenant_id()` returns null if user has no profile — queries silently filter nothing
  2. `is_superadmin()` is called in USING clauses that should fail explicitly
  3. No error handling if `auth.uid()` returns null
- **Code snippet (001, line 147):**
  ```sql
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
  ```
  Returns null if no profile, which passes through silently
- **Impact:** If a user doesn't have a profile (edge case), RLS policies don't block them — they just don't match any row (good luck by accident)
- **Evidence:** Superadmin email config in `src/lib/auth/role-utils.ts` creates profiles on-the-fly (lines 21-26), suggesting profile existence is not guaranteed
- **Safe modification:**
  1. Test what happens when `auth.uid()` is called before user profile exists
  2. Add explicit profile existence check in sensitive policies
  3. Use RAISE EXCEPTION instead of silent failures
- **Test coverage:** No test files found (see below)
- **Priority:** MEDIUM — Currently safe due to auth flow, but risky if auth changes

### Menu/Category/Product Cascade Delete
- **Issue:** `supabase/migrations/019_full_schema_sync.sql` lines 89-90 add `menu_id` foreign keys with ON DELETE CASCADE
- **Files:** `supabase/migrations/019_full_schema_sync.sql` (lines 89-90)
- **Problem:**
  1. If a menu is deleted, all its categories/products cascade delete (expected)
  2. But `is_default` menu used by orphan data (lines 98-107) — what if default menu is deleted?
  3. No constraint to prevent deletion of default/only menu
- **Code snippet (migration 019):**
  ```sql
  UPDATE categories c
  SET menu_id = m.id
  FROM menus m
  WHERE m.tenant_id = c.tenant_id AND m.is_default = true AND c.menu_id IS NULL;
  ```
  After this, categories are tied to default menu. If deleted, they're lost.
- **Impact:** Accidental deletion of "Main Menu" wipes all unassigned items
- **Fix approach:** 
  1. Add CHECK constraint: every tenant must have at least one menu
  2. Or: prevent deletion of `is_default = true` menus via RLS/trigger
  3. Or: require explicit reassignment before deletion
- **Priority:** MEDIUM — Possible data loss if admin accidentally deletes "Main Menu"

## Test Coverage Gaps

### No Test Files Found
- **Issue:** Zero test files in codebase
- **Files:** None found (search returned no `*.test.ts`, `*.spec.ts`, etc.)
- **Uncovered areas:**
  1. RLS policies — no way to verify multi-tenant isolation
  2. Auth flows — forced password change, superadmin bypass
  3. API endpoints — tenant authorization, input validation
  4. Multi-language menu translations
  5. Order creation and webhook handling (if any)
  6. Staff creation and role enforcement
- **Impact:** 
  - Risk of regression when refactoring RLS
  - No regression testing for tenant isolation after schema changes (like 019)
  - New features added without safety verification
- **Fix approach:**
  1. Add vitest or jest config (`jest.config.js` or `vitest.config.ts`)
  2. Create test suites for:
     - Auth (must_change_password flow)
     - RLS policies (tenant isolation, staff permissions)
     - API endpoints (tenant filtering, role checks)
  3. Run in CI pipeline
- **Priority:** HIGH — Multi-tenant system without tests is risky

### No E2E Tests
- **Issue:** No integration/E2E test framework visible
- **Files:** None found
- **Gap:** Flows like "staff created > must change password > login > access restricted routes" never verified end-to-end
- **Fix approach:** Add Playwright or Cypress tests for critical user journeys
- **Priority:** MEDIUM — Good to have but RLS provides some safety net

## CI/CD Gaps

### Single Workflow With No Build/Deploy
- **Issue:** Only `.github/workflows/supabase-keepalive.yml` exists
- **Files:** `.github/workflows/supabase-keepalive.yml`
- **Missing:**
  1. No test runner (no `npm test` or equivalent in CI)
  2. No linting (no `npm run lint` check)
  3. No build verification (no `npm run build` check)
  4. No deployment pipeline
  5. No database migration validation
- **Impact:** 
  - Broken builds can be pushed to main
  - Database migrations never tested before production
  - Type errors and linting issues not caught
- **Evidence:** 
  - `package.json` (912 bytes) has scripts but no CI uses them
  - ESLint config exists (`eslint.config.mjs`) but never runs in CI
- **Fix approach:**
  1. Add test job: `npm run test` (need to add test script to package.json)
  2. Add lint job: `npm run lint`
  3. Add build job: `npm run build`
  4. Add migration validation: test against preview Supabase instance
  5. Only merge if all pass
- **Priority:** HIGH — Quality gate missing

## Deployment & Infrastructure

### Service Role Key Exposure Vector
- **Issue:** `src/app/api/superadmin/tenants/route.ts` and staff endpoints use `createServiceClient()`
- **Files:** Multiple API routes use `createServiceClient()`
- **Problem:** Service role key is passed to client code, trust boundary issue if key is compromised
- **Current mitigation:** Only used in server-side Next.js API routes (good), but if someone compromises the key, they have full DB access
- **Evidence:** `SUPABASE_SERVICE_ROLE_KEY` is in `.env.example` (line 3)
- **Fix approach:** 
  1. Ensure service role key is only in `.env.local` (server-side), never in `.env.example` with real value
  2. Use row-level security for service role calls where possible (currently bypassed)
  3. Log/audit service role calls
- **Priority:** MEDIUM — Mitigated by file permissions but good practice

### No Database Backup/Recovery Plan
- **Issue:** Not visible in codebase, but multi-tenant production database has no documented recovery strategy
- **Impact:** Data loss scenarios (accidental cascade delete, ransomware, etc.) have no recovery path
- **Fix approach:** 
  1. Document Supabase automatic backups are enabled
  2. Test recovery procedure
  3. Add migration rollback procedure to deployment checklist
- **Priority:** LOW — Supabase handles backups automatically

## Summary by Severity

| Severity | Count | Examples |
|----------|-------|----------|
| CRITICAL | 1 | Service role key commitment |
| HIGH | 4 | Orders RLS, tenant isolation inconsistency, password change bypass, CI gaps |
| MEDIUM | 8 | N+1 queries, multi-tenant resolution fallbacks, default password, indices, RLS helpers, menu cascade, superadmin cookie, staff role scope |
| LOW | 3 | Large components, backup docs, infrastructure |

---

*Concerns audit: 2026-05-05*
