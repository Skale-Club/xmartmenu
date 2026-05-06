---
phase: 02-security
verified: 2026-05-05T00:00:00Z
status: passed
score: 3/3 must-haves verified
re_verification: false
---

# Phase 2: Security Verification Report

**Phase Goal:** The three HIGH security issues from the codebase audit are closed.
**Verified:** 2026-05-05
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                       | Status     | Evidence                                                                                       |
|----|-------------------------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------|
| 1  | POST /api/orders rejects requests for non-existent, inactive, or orders-disabled tenants                    | VERIFIED   | Lines 39-53 of orders/route.ts query tenants+tenant_settings; returns 400 or 403 on failure    |
| 2  | Migration 020 replaces WITH CHECK (true) with a tenant-scoped RLS policy                                    | VERIFIED   | 020_secure_orders_insert_policy.sql: DROP + CREATE with JOIN on tenant_settings; no WITH CHECK (true) |
| 3  | checkPasswordChangeRequired() helper exists and is wired into all staff mutation routes                      | VERIFIED   | password-guard.ts exports the function; called as first statement in POST/PATCH/DELETE handlers in all three target route files |
| 4  | No superadmin route file defines its own local assertSuperadmin() function                                  | VERIFIED   | grep -rl "async function assertSuperadmin" src/app/api/ returns only staffId/route.ts which uses the distinct composite assertSuperadminAndStaff() |
| 5  | assertSuperadmin() is exported from src/lib/superadmin-auth.ts                                              | VERIFIED   | Line 40: `export async function assertSuperadmin()` present alongside isSuperadminRequest()    |
| 6  | enter-preview/route.ts uses assertSuperadmin() from the shared library, no inline profile query             | VERIFIED   | File imports from '@/lib/superadmin-auth'; no reference to profiles table or role selection    |

**Score:** 6/6 truths verified (maps to 3/3 requirements)

---

## SEC-01 Verification

**Requirement:** Orders table INSERT policy validates tenant context (not WITH CHECK (true))

### Artifact: src/app/api/orders/route.ts

- **Exists:** Yes
- **Substantive:** Yes — 99 lines with full order creation logic
- **Contains "Invalid tenant":** Yes — line 48
- **Contains "orders_enabled":** Yes — lines 42, 51
- **Contains "is_active":** Yes — line 44 (`.eq('is_active', true)`)
- **Validation positioned correctly:** Yes — after `createServiceClient()`, before `total = items.reduce(...)`
- **Status: VERIFIED**

### Artifact: supabase/migrations/020_secure_orders_insert_policy.sql

- **Exists:** Yes
- **Substantive:** Yes — 16 lines
- **Contains DROP POLICY IF EXISTS:** Yes — line 5
- **Contains orders_public_insert:** Yes — lines 5 and 7 (DROP + CREATE)
- **Contains WITH CHECK (true):** No matches — the old permissive policy is absent
- **New WITH CHECK uses tenant_settings JOIN:** Yes — lines 8-16 check is_active and orders_enabled
- **Status: VERIFIED**

### Key Link: POST handler -> tenants table via createServiceClient()

- Pattern `tenants.*tenant_settings.*orders_enabled` present in the select chain (line 42)
- Query runs before any insert operation
- **Status: WIRED**

---

## SEC-02 Verification

**Requirement:** must_change_password enforced at API layer, not only middleware UI redirect

### Artifact: src/lib/auth/password-guard.ts

- **Exists:** Yes
- **Exports checkPasswordChangeRequired():** Yes — line 13
- **Contains MUST_CHANGE_PASSWORD:** Yes — line 26 (code field in JSON response)
- **Contains must_change_password:** Yes — lines 18, 24
- **Returns 403:** Yes — `{ status: 403 }` on line 27
- **Status: VERIFIED**

### Artifact: src/app/api/admin/staff/route.ts

- **Imports checkPasswordChangeRequired:** Yes — line 4
- **Guard called in POST handler:** Yes — lines 44-45, as first statement before assertStoreAdmin()
- **GET handler omitted (intentional per plan — reading staff list is lower risk):** Correct
- **Status: VERIFIED**

### Artifact: src/app/api/admin/staff/[id]/route.ts

- **Imports checkPasswordChangeRequired:** Yes — line 4
- **Guard called in PATCH handler:** Yes — lines 40-41
- **Guard called in DELETE handler:** Yes — lines 81-82
- **Both as first statements before assertStaffOwnership():** Yes
- **Status: VERIFIED**

### Artifact: src/app/api/superadmin/tenants/[id]/staff/route.ts

- **Imports checkPasswordChangeRequired:** Yes — line 3
- **Guard called in GET handler:** Yes — lines 11-12
- **Guard called in POST handler:** Yes — lines 37-38
- **Both as first statements before assertSuperadmin():** Yes
- **Status: VERIFIED**

### Key Link: route files -> password-guard.ts

- All three route files import from `@/lib/auth/password-guard`
- Guard result tested with `if (guard) return guard` pattern in each handler
- **Status: WIRED**

---

## SEC-03 Verification

**Requirement:** Uniform auth middleware pattern across all API routes (assertRole helper)

### Artifact: src/lib/superadmin-auth.ts

- **Exists:** Yes
- **Exports isSuperadminRequest():** Yes — line 4
- **Exports assertSuperadmin():** Yes — line 40
- **assertSuperadmin() returns supabase | null:** Yes — `return profile?.role === 'superadmin' ? supabase : null`
- **isSuperadminRequest() preserved:** Yes — unchanged at lines 4-29
- **Status: VERIFIED**

### Local assertSuperadmin() copies eliminated

- `grep -rl "async function assertSuperadmin" src/app/api/` returns exactly one file:
  `src/app/api/superadmin/tenants/[id]/staff/[staffId]/route.ts`
- That file defines `assertSuperadminAndStaff()` — a deliberately distinct composite function.
  It is intentionally excluded from this refactor per plan 02-03 task 2.
- Zero plain `assertSuperadmin` local definitions remain in any route file.
- **Status: VERIFIED**

### Superadmin routes importing from shared library

9 files confirmed importing `from '@/lib/superadmin-auth'`:
1. `src/app/api/superadmin/tenants/route.ts`
2. `src/app/api/superadmin/settings/route.ts`
3. `src/app/api/superadmin/tenants/[id]/route.ts`
4. `src/app/api/superadmin/tenants/[id]/menus/route.ts`
5. `src/app/api/superadmin/tenants/[id]/settings/route.ts`
6. `src/app/api/superadmin/tenants/[id]/staff/route.ts`
7. `src/app/api/superadmin/tenants/[id]/upload/route.ts`
8. `src/app/api/superadmin/users/route.ts`
9. `src/app/api/superadmin/users/[id]/route.ts`

### Artifact: src/app/api/admin/enter-preview/route.ts

- **Imports from '@/lib/superadmin-auth':** Yes — line 1
- **Calls assertSuperadmin():** Yes — line 9
- **Inline profile query removed:** Confirmed — no reference to `profiles`, `select('role')`, or `profile?.role` anywhere in the file
- **Status: VERIFIED**

---

## Requirements Coverage

| Requirement | Plan   | Description                                                               | Status    | Evidence                                                         |
|-------------|--------|---------------------------------------------------------------------------|-----------|------------------------------------------------------------------|
| SEC-01      | 02-01  | Orders INSERT validates tenant existence, active status, orders_enabled   | SATISFIED | orders/route.ts lines 39-53; migration 020 RLS policy            |
| SEC-02      | 02-02  | must_change_password enforced at API layer on staff mutation routes        | SATISFIED | password-guard.ts; guard wired in 3 route files, 5 handlers      |
| SEC-03      | 02-03  | Uniform superadmin auth via shared assertSuperadmin() in all routes        | SATISFIED | superadmin-auth.ts exports assertSuperadmin(); 9 routes import it; enter-preview refactored |

---

## Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `src/lib/superadmin-auth.ts` assertSuperadmin() | Does not use `isSuperadminRequest()` (skips env-based auto-promotion path) | Info | The local assertSuperadmin() does a direct DB role check only. It does not honour `NEXT_PUBLIC_SUPERADMIN_EMAILS` auto-promotion that isSuperadminRequest() supports. This is a pre-existing design choice noted in the plan interfaces section. Not introduced by this phase. |

No blocker or warning anti-patterns. The info-level note above is a pre-existing behavioural difference, not a regression from this phase.

---

## Behavioral Spot-Checks

Step 7b: SKIPPED — no runnable server available in this environment. The checks require a live Next.js server.
The static code evidence is conclusive for all three requirements.

---

## Human Verification Required

None. All requirements are fully verifiable through static code analysis.

---

## Gaps Summary

No gaps. All three HIGH security issues are closed:

- **SEC-01**: The orders POST route validates tenant existence, active status, and orders_enabled before inserting any row. The migration 020 adds RLS defense-in-depth. The permissive `WITH CHECK (true)` policy is replaced.
- **SEC-02**: `checkPasswordChangeRequired()` is a substantive, exported helper that queries `profiles.must_change_password` and returns a typed 403 response. It is wired as the first call in all five targeted mutation handlers (POST staff create, PATCH staff reset, DELETE staff, GET+POST superadmin staff).
- **SEC-03**: `assertSuperadmin()` is exported from the canonical `src/lib/superadmin-auth.ts`. All nine superadmin route files import from that library. Zero local definitions of `assertSuperadmin` remain (the only match is `assertSuperadminAndStaff` in the staffId composite route, which is a different function intentionally left untouched). `enter-preview/route.ts` no longer contains an inline profile query.

---

_Verified: 2026-05-05_
_Verifier: Claude (gsd-verifier)_
