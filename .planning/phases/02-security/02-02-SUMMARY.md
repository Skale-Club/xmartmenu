---
plan: 02-02
status: complete
completed: 2026-05-06
---

# Plan 02-02 Summary: Enforce must_change_password at API layer

## Objective
Prevent provisioned staff from bypassing the forced password reset by calling admin API routes directly, without going through the UI redirect.

## What Was Built
- **`src/lib/auth/password-guard.ts`**: New helper `checkPasswordChangeRequired()` — queries `profiles.must_change_password` for the current user and returns a 403 NextResponse if true (`{ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' }`), or null if the user can proceed.
- **3 staff routes protected**: Guard added to `POST /api/admin/staff`, `PATCH/DELETE /api/admin/staff/[id]`, and `GET/POST /api/superadmin/tenants/[id]/staff` — all routes where bypassing the password change has direct security impact (user creation, role management).

## Key Files
- `src/lib/auth/password-guard.ts` — new guard helper (created)
- `src/app/api/admin/staff/route.ts` — guard added
- `src/app/api/admin/staff/[id]/route.ts` — guard added
- `src/app/api/superadmin/tenants/[id]/staff/route.ts` — guard added

## Commits
- `7e31005` feat(02-02): create checkPasswordChangeRequired password guard helper
- `3332f8b` feat(02-02): add password guard to admin staff API routes
- `5a0c36f` feat(02-02+02-03): guard added to superadmin staff route (combined commit)

## Self-Check: PASSED
