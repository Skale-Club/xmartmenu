---
plan: 02-01
status: complete
completed: 2026-05-06
---

# Plan 02-01 Summary: Fix orders INSERT validation

## Objective
Prevent anonymous users from inserting orders for arbitrary tenants by validating tenant context at the API layer and replacing the permissive RLS policy.

## What Was Built
- **API layer validation** (primary fix): Added tenant validation to `POST /api/orders` before any DB insert. Checks that the `tenant_id` corresponds to an active tenant with `orders_enabled = true`. Returns 400 for invalid tenant, 403 for orders not enabled.
- **Migration 020** (defense-in-depth): Replaced `WITH CHECK (true)` policy with a policy that verifies the tenant is active and has orders enabled — blocks direct Supabase SDK calls that bypass the API.

## Key Files
- `src/app/api/orders/route.ts` — tenant validation added before insert
- `supabase/migrations/020_secure_orders_insert_policy.sql` — new restrictive RLS policy

## Commits
- `c9e0d81` feat(02-01): add tenant validation to orders POST handler
- `c882b73` chore(02-01): add migration 020 to replace permissive orders INSERT RLS policy

## Self-Check: PASSED
