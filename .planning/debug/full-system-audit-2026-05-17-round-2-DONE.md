---
status: shipped
created: 2026-05-17
commits:
  - 5f571ba — hotfix middleware revert (P0-01)
  - 2be27a8 — Wave A code P0s (P0-03..P0-08)
  - c0e03e8 — Wave B+C migration 033 + polish (P0-02, P1-01, P1-02, P1-04, P1-05, P1-08)
  - 38f3504 — Wave D onboarding/subscription (P1-03)
---

# Round-2 Audit Remediation — Shipped 2026-05-17

## Bottom line

Round 2 found **29 new issues** (8 P0, 9 P1, 9 P2, 3 P3) on top of round 1's fixes. **All 8 P0s** and **6 of 9 P1s** are now fixed. The biggest finding was a **regression I introduced in round-1 Wave 4** that took every admin/API URL offline — hotfixed first.

| Round | P0 found | P0 fixed | P1 found | P1 fixed |
|---|---|---|---|---|
| Round 1 | 11 | 11 | 9 | 8 (rate limiting deferred) |
| Round 2 | 8 | 8 | 9 | 6 |

## Hotfix

**P0-01 — middleware blocked every admin/api URL.** Round-1 Wave 4 unified `BLOCKED_TENANT_SLUGS` with `RESERVED_PATHS`, ignoring an explicit code comment that said *"only add slugs here that have NO named file."* Production was returning `{"error":"Not found"}` on every `/auth/*`, `/api/*`, `/dashboard`, `/admin/*`, `/onboarding`, the Stripe webhook, and the login page itself. Reverted to the marketing-only list in `5f571ba`.

## Wave A — Code P0s (`2be27a8`)

| Issue | Where | What |
|---|---|---|
| P0-03 | `confirmation/page.tsx:165` | `order.total_cents` → `Number(order.total)` (was rendering "R$ NaN") |
| P0-04 | `checkout/page.tsx:141` + `confirmation/page.tsx:175` | Two more `/menu/${slug}` → `/${slug}` |
| P0-05 | `orders/[id]/route.ts` + `OrdersClient.tsx` | `paid` + `payment_failed` added to VALID_STATUSES, STATUS_COLORS, NEXT_STATUS, ADVANCE_LABEL. State machine documented in code. |
| P0-06 | `OrdersClient.tsx:221-302` | Realtime channel now subscribes to UPDATE in addition to INSERT (webhook status changes reach KDS instantly). Polling merges by id instead of clobbering. |
| P0-07 | `stripe/connect/disconnect/route.ts` | Cookie client → service client (RLS had no UPDATE policy, was silently failing) |
| P0-08 | `(public)/[slug]/page.tsx` + `[menuSlug]/page.tsx` | ISR-cached pages no longer try to record scans. New `POST /api/public/scan` + `<ScanRecorder/>` client island fires per visit. |

## Wave B+C — Migration 033 + polish (`c0e03e8`)

**Migration 033** (applied + repaired in `supabase_migrations`):
- `profiles_role_check` now accepts `customer` (was rejecting it — caused silent failure in 3 code paths)
- Backfilled 4 orphan profiles (`tenant_id IS NULL`, role=store-admin) → `role=customer`
- `tenant_subscriptions.plan_id` FK → ON DELETE RESTRICT
- `scan_events.tenant_id` FK → ON DELETE CASCADE (consistency with all other tenant-scoped child tables)

**Code polish:**
- P1-01: `src/lib/auth/password-gen.ts` — `crypto.randomInt` replaces `Math.random` in 4 password generators and the customer-register email suffix
- P1-02: `admin/tenants/[id]` PATCH now explicit-401s instead of crashing on `effective!`
- P1-08: `src/types/database.ts` synced with live DB — `ProcessedStripeEvent.event_id/event_type`, `Order.payment_intent_id` + extended status union, `StripeConnection` lifecycle columns, `TenantSubscription.cancel_at_period_end`
- Staff DELETE handlers (admin + superadmin) now check the demote-to-customer error and return 500 instead of silent `{ok:true}`

## Wave D — Onboarding subscription (`38f3504`)

P1-03 fixed: onboarding now looks up the entry-level plan (`slug='menu'`) and creates a `tenant_subscriptions` row alongside the tenant. Before, every new tenant had `getTenantPlan() === null` so every feature gate (orders, payments, stripe-connect) returned false even after they paid. The legacy `tenants.plan='free'` column is left as a denormalized snapshot pending a future column-drop migration.

## Deferred (with reason)

| Issue | Why |
|---|---|
| P1-06 | `platform_settings` has RLS without policies — works today via service client. Decision pending: tighten policies or document service-role-only. |
| P1-07 | OG `images: ['']` when logo is null — needs platform-level fallback image asset choice. |
| P1-09 | Dead `super-admin` alias in `normalizeRole` — defensive, low risk, not removed. |
| P2 cluster | All 9 are UX/perf/style polish (state-machine smells, storage bucket limits, public RLS tightening). None are silent breakage; deserve their own phase. |
| P3 cluster | Env validator, `auth_tenant_id()` null fallback, unsplash whitelist — same. |

## Verification

- `npx tsc --noEmit` — exit 0
- `npm run build` — exit 0 (no errors)
- `supabase migration list` — 033 sync'd in remote `schema_migrations`
- `gh api ... actions/runs` — last 3 commits ✅ CI green (38f3504 in progress at write time)

## Structural recommendations (still standing from round 1)

1. **DB types codegen in CI.** `supabase gen types typescript --linked` + `git diff --exit-code`. Would have caught P0-02, P0-03, P1-08 immediately.
2. **Integration tests for API routes.** Smoke tests would have caught every "missing status whitelist", "missing auth", "wrong column read" bug in both rounds.
3. **Verify-the-fix pass.** Round-1 Wave 4 introduced P0-01 while fixing P2-03. A short diff review by another pair of eyes on hotfix landings would have caught it before push.

## Files touched (round 2)

```
supabase/migrations/033_profiles_customer_role_and_fk_hardening.sql  [new]
scripts/apply-migration-033.mjs                                       [new]
src/lib/auth/password-gen.ts                                          [new]
src/app/api/public/scan/route.ts                                      [new]
src/components/menu/ScanRecorder.tsx                                  [new]
src/middleware.ts                                                     [hotfix]
src/app/(public)/[slug]/page.tsx
src/app/(public)/[slug]/[menuSlug]/page.tsx
src/app/(public)/checkout/[orderId]/page.tsx
src/app/(public)/checkout/[orderId]/confirmation/page.tsx
src/app/(admin)/orders/OrdersClient.tsx
src/app/api/orders/[id]/route.ts
src/app/api/auth/register/route.ts
src/app/api/admin/tenants/[id]/route.ts
src/app/api/admin/staff/route.ts
src/app/api/admin/staff/[id]/route.ts
src/app/api/superadmin/tenants/route.ts
src/app/api/superadmin/tenants/[id]/staff/[staffId]/route.ts
src/app/api/stripe/connect/disconnect/route.ts
src/app/api/onboarding/route.ts
src/types/database.ts
```
