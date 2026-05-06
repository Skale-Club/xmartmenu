---
plan: 02-03
status: complete
completed: 2026-05-06
---

# Plan 02-03 Summary: Unify superadmin auth

## Objective
Eliminate 10 local copies of `assertSuperadmin()` scattered across superadmin API routes and replace with a single canonical export from `src/lib/superadmin-auth.ts`.

## What Was Built
- **Canonical `assertSuperadmin()`** added to `src/lib/superadmin-auth.ts` — returns `supabase | null`, compatible with both Pattern A (use client) and Pattern B (truthy check) callers.
- **4 files with local copies updated**: `superadmin/tenants/[id]/upload/route.ts`, `superadmin/users/route.ts`, `superadmin/users/[id]/route.ts`, `admin/enter-preview/route.ts` — local functions removed, import added.
- **Previously-committed routes**: `superadmin/tenants/route.ts` and `superadmin/settings/route.ts` were handled by the 02-03 partial agent (commit `bc55a55`).
- **`assertSuperadminAndStaff()`** in `staffId/route.ts` intentionally excluded — it's a different composite function, not a copy of `assertSuperadmin`.

## Key Files
- `src/lib/superadmin-auth.ts` — canonical assertSuperadmin() added
- `src/app/api/superadmin/tenants/[id]/upload/route.ts` — local copy removed
- `src/app/api/superadmin/users/route.ts` — local copy removed
- `src/app/api/superadmin/users/[id]/route.ts` — local copy removed
- `src/app/api/admin/enter-preview/route.ts` — inline auth replaced with assertSuperadmin()

## Commits
- `bc55a55` feat(02-03): add assertSuperadmin() export to superadmin-auth.ts
- `5a0c36f` feat(02-02+02-03): remaining routes updated (combined commit)

## Self-Check: PASSED
