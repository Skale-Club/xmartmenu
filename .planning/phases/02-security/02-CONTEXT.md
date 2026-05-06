# Phase 2: Security — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Source:** Codebase audit (CONCERNS.md) + direct source file inspection

<domain>
## Phase Boundary

Close the 3 HIGH security issues identified in `.planning/codebase/CONCERNS.md`. No new features, no refactoring beyond what's needed to close these issues. Each maps to one plan.

**Out of scope:**
- Full test suite (deferred)
- RLS audit beyond orders table
- Default staff password fix (MEDIUM, not HIGH)
- Superadmin cookie preview validation (MEDIUM)

</domain>

<decisions>
## Implementation Decisions

### SEC-01: Orders INSERT validation (Plan 2.1)

**Current state:**
- `supabase/migrations/019_full_schema_sync.sql` has `CREATE POLICY "orders_public_insert" ON orders FOR INSERT WITH CHECK (true)` — anyone can insert for any tenant
- `/api/orders/route.ts` uses `createServiceClient()` (service role — bypasses RLS). The API validates field presence but NOT that the tenant exists/is active, NOT that `orders_enabled = true` for that tenant

**Fix (two-layer):**

Layer 1 — API validation (primary defense, service role means RLS is bypassed):
In `src/app/api/orders/route.ts`, before creating the order, validate:
```ts
// Verify tenant exists, is active, and has orders enabled
const { data: tenantSettings, error: tenantError } = await service
  .from('tenants')
  .select('id, is_active, tenant_settings(orders_enabled)')
  .eq('id', tenant_id)
  .eq('is_active', true)
  .single()

if (tenantError || !tenantSettings) {
  return NextResponse.json({ error: 'Invalid tenant' }, { status: 400 })
}
const settings = (tenantSettings.tenant_settings as any)
if (!settings?.orders_enabled) {
  return NextResponse.json({ error: 'Orders not enabled for this tenant' }, { status: 403 })
}
```

Layer 2 — RLS defense-in-depth (blocks direct Supabase SDK calls):
Create migration `020_secure_orders_insert_policy.sql` to replace the policy:
```sql
-- Drop permissive policy
DROP POLICY IF EXISTS "orders_public_insert" ON orders;

-- Replace with tenant-scoped policy (allows anonymous INSERT only if tenant has orders enabled)
CREATE POLICY "orders_public_insert" ON orders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenants t
      JOIN tenant_settings ts ON ts.tenant_id = t.id
      WHERE t.id = orders.tenant_id
        AND t.is_active = true
        AND ts.orders_enabled = true
    )
  );
```

### SEC-02: must_change_password API enforcement (Plan 2.2)

**Current state:**
- `src/lib/supabase/middleware.ts` lines 85-91: checks `must_change_password` and redirects UI pages to `/settings/password`
- API routes under `/api/admin/*` don't check the flag — staff can call them directly after provisioning without changing password

**Fix:**
Modify `src/lib/get-effective-tenant.ts`:
- Add `must_change_password` to the profiles select query: `.select('role, tenant_id, must_change_password, tenants(slug, name)')`
- If `profile.must_change_password === true`, return a special marker so callers can act on it

Modify all `/api/admin/*` route handlers that call `getEffectiveTenant()`:
- After getting `effective`, check if password change is required
- Return `{ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' }` with HTTP 403

To avoid modifying every route handler individually, the cleanest approach:
Add a helper `requireEffectiveTenant()` in `src/lib/get-effective-tenant.ts` that:
1. Calls `getEffectiveTenant()`
2. Also queries `must_change_password` from the profile
3. If `must_change_password=true`, throws or returns null with a flag

Since modifying every handler is risky (many files), prefer: update `getEffectiveTenant()` to return `null` if `must_change_password=true`, and document the behavior. All routes that check `if (!effective) return 401` will automatically block. The 401 vs 403 distinction is acceptable — the middleware will intercept the redirect for UI flows.

Actually simpler and safer — add a standalone `assertNotMustChangePassword()` utility:
```ts
// src/lib/auth/password-guard.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function checkPasswordChangeRequired(): Promise<NextResponse | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('must_change_password')
    .eq('id', user.id)
    .single()

  if (profile?.must_change_password === true) {
    return NextResponse.json(
      { error: 'Password change required before accessing this resource', code: 'MUST_CHANGE_PASSWORD' },
      { status: 403 }
    )
  }
  return null
}
```

Add this check to the most sensitive admin routes: staff creation, staff management, settings changes. Adding to ALL admin routes would require touching too many files — focus on the ones where bypassing the password change has real security impact:
- `src/app/api/admin/staff/route.ts` (staff CRUD — highest risk)
- `src/app/api/admin/staff/[id]/route.ts`
- `src/app/api/superadmin/tenants/[id]/staff/route.ts`

### SEC-03: Unified superadmin auth (Plan 2.3)

**Current state:**
- `src/app/api/superadmin/tenants/route.ts` has a LOCAL `assertSuperadmin()` function (lines 4-16) that returns the supabase client or null
- `src/app/api/superadmin/settings/route.ts` has another LOCAL `assertSuperadmin()` function — duplicated
- `src/lib/superadmin-auth.ts` already exists with `isSuperadminRequest()` — different interface
- Admin routes use `getEffectiveTenant()` from `src/lib/get-effective-tenant.ts` — consistent ✓
- Some routes (`enter-preview`, `staff/[id]`) do manual `auth.getUser()` + profile query inline — inconsistent

**Fix:**
1. Add `assertSuperadmin()` to `src/lib/superadmin-auth.ts` — same signature as local copies (returns `supabase | null`):
```ts
export async function assertSuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'superadmin' ? supabase : null
}
```

2. In superadmin route files, replace the local `assertSuperadmin` function with an import:
```ts
import { assertSuperadmin } from '@/lib/superadmin-auth'
```
Files to update:
- `src/app/api/superadmin/tenants/route.ts`
- `src/app/api/superadmin/settings/route.ts`
- `src/app/api/superadmin/tenants/[id]/menus/route.ts` (if it has a local copy)
- `src/app/api/superadmin/tenants/[id]/settings/route.ts` (if it has a local copy)
- `src/app/api/superadmin/tenants/[id]/staff/route.ts` (if it has a local copy)
- `src/app/api/superadmin/users/route.ts` (if it has a local copy)
- `src/app/api/admin/enter-preview/route.ts` — currently does inline profile query, replace with `assertSuperadmin()`

</decisions>

<canonical_refs>
## Canonical References

- `src/app/api/orders/route.ts` — orders creation API (SEC-01, primary fix)
- `supabase/migrations/019_full_schema_sync.sql` — current orders RLS policy (SEC-01, RLS fix)
- `src/lib/get-effective-tenant.ts` — tenant resolution used by all admin routes (SEC-02)
- `src/lib/superadmin-auth.ts` — existing superadmin auth utilities (SEC-03, add assertSuperadmin here)
- `src/app/api/superadmin/tenants/route.ts` — has local assertSuperadmin to replace (SEC-03)
- `src/app/api/superadmin/settings/route.ts` — has local assertSuperadmin to replace (SEC-03)
- `src/app/api/admin/enter-preview/route.ts` — inline auth query to replace (SEC-03)
- `src/app/api/admin/staff/route.ts` — highest-risk route for SEC-02
- `src/app/api/admin/staff/[id]/route.ts` — SEC-02
- `src/app/api/superadmin/tenants/[id]/staff/route.ts` — SEC-02
- `supabase/migrations/` — new migration goes here as 020_secure_orders_insert_policy.sql

</canonical_refs>

<specifics>
## Specific Implementation Details

### Migration 020 filename
`supabase/migrations/020_secure_orders_insert_policy.sql`

### Check which superadmin routes have local assertSuperadmin
Before writing plans, executor should run:
```bash
grep -rl "async function assertSuperadmin" src/app/api/
```
to find all files with local copies.

### orders route: tenant_settings join
The `tenant_settings` table has `tenant_id` FK to `tenants`. Query pattern:
```ts
.from('tenants')
.select('id, is_active, tenant_settings(orders_enabled)')
.eq('id', tenant_id)
.eq('is_active', true)
.single()
```

### Plan 2.2 scope decision (deliberate)
Full enforcement in ALL admin routes requires touching 20+ files — high blast radius, high test regression risk. Scoped to the 3 staff-management routes where bypassing password change has real attack surface. Other admin routes are lower risk (menus, categories, branding are data, not access control).

</specifics>

<deferred>
## Deferred

- Default staff password hardcoded fallback `'Staff@12345'` — MEDIUM, not blocking
- Superadmin cookie validation in getEffectiveTenant — MEDIUM
- Full must_change_password enforcement in ALL admin routes — deferred to full security audit
- Missing indices for RLS helpers — SEED-004 full milestone
</deferred>

---

*Phase: 02-security*
*Context gathered: 2026-05-06*
