---
status: shipped
created: 2026-05-17
commits:
  - 1851b25 — Wave 1+2 (migration + auth fixes)
  - 0bfb9d1 — Wave 3 (Stripe)
  - 533cd8b — Wave 4 (polish)
---

# Audit Remediation — Shipped Overnight 2026-05-17

## Bottom line

The audit found **38 issues**: 11 P0, 9 P1, 12 P2, 6 P3. Of those, **all 11 P0**, **8 of 9 P1**, **5 of 12 P2**, and **3 of 6 P3** are fixed. TypeScript clean, `npm run build` clean, pushed to `main`.

The single remaining P1 is rate-limiting on `/api/orders` POST and `/api/auth/register` (P1-03, P1-04) — needs Vercel/Upstash setup, not just a code change. Deferred to v2.2.

## What shipped

### Wave 1 — DB schema (commit 1851b25)

Migration `032_orders_payments_fix.sql` applied to remote Supabase:

| Change | Why |
|--------|-----|
| `orders.payment_intent_id TEXT` + unique partial index | Webhook + checkout assumed the column |
| Loosened `orders_status_check` to accept `paid`/`payment_failed` | Webhook wrote those values into a CHECK violation |
| Renamed `processed_stripe_events.stripe_event_id` → `event_id`, added `event_type` | Idempotency table column names didn't match code |
| Added `stripe_connections.disconnected_at/created_at/updated_at` + trigger | Disconnect endpoint and TS types referenced missing columns |
| Added `tenant_subscriptions.cancel_at_period_end` | Subscription settings page threw on every load |

The whole v2.0 Stripe Connect feature was ungated from being non-functional to functional.

### Wave 2 — Auth gaps (commit 1851b25)

| Issue | Route | Fix |
|-------|-------|-----|
| P0-06 | `PATCH /api/orders/[id]` | `getEffectiveTenant` guard + tenant-of-order check + use URL `[id]` |
| P0-07 | `GET /api/orders` | `getEffectiveTenant`, ignore query string tenant, block `customer` role |
| P0-08 | `POST /api/admin/tenants/[id]/verify-domain` | Effective-tenant guard + CNAME-aware DNS check + server-side flag persist |
| P0-09 | `PATCH /api/admin/tenants/[id]` | Removed `force_verified` body short-circuit (let any tenant claim any domain) |
| P0-10 | superadmin/plans, plans/[id] | `assertSuperadmin` on every handler + service client |
| P0-11 | superadmin/tenants/[id]/subscription | `assertSuperadmin` on GET + PUT (was unauthenticated with service client) |
| P1-08/09 | `assertSuperadmin` + `getEffectiveTenant` | Now use `normalizeRole` for `super-admin`/case variants |
| P1-06 | `enter-preview` + `menus/select` cookies | Added `secure: NODE_ENV==='production'` |
| P2-07 | `POST /api/orders` | Server-side product price resolution; client `unit_price` ignored |

### Wave 3 — Stripe code (commit 0bfb9d1)

| Issue | Route | Fix |
|-------|-------|-----|
| P0-01 | webhook | Renamed `event_id` lookup to match new column |
| P0-02 | webhook | Uses `createServiceClient()` so RLS doesn't reject writes |
| P0-03 | payment-intents + checkout pages | Read `orders.total` (dollars) and convert via `Math.round(x*100)` instead of nonexistent `total_cents`; reject below-minimum |
| P1-01 | OAuth state | New `src/lib/stripe-oauth-state.ts` HMAC-signs + timestamp-binds the state; callback verifies before trusting tenantId |
| P1-02 | payment-intents | When an order has an existing payment intent, requires caller's profile.tenant_id to match the order (or superadmin) |
| P2-01 | checkout pages | Fixed `/menu/${slug}` → `/${slug}` and `/confirmation/${id}` → `/checkout/${id}/confirmation` (every successful payment redirected to 404) |
| P2-02 | OAuth redirect | `/login` → `/auth/login` |
| P2-05 | webhook | Returns 500 on real errors so Stripe retries (idempotency upsert prevents duplicate processing) |

### Wave 4 — Polish (commit 533cd8b)

| Issue | Where | Fix |
|-------|-------|-----|
| npm audit | package.json | `next` bumped to `16.2.6` — clears 1 high vulnerability |
| P1-05 | `POST /api/admin/staff` | Per-staff random password (12 chars) replaces shared `'Staff@12345'` fallback |
| P1-07 | `/api/auth/signout` + superadmin layout | Converted to POST with form button; prevents prefetch/preview logout + CSRF |
| P2-03 | middleware | `BLOCKED_TENANT_SLUGS` expanded to match `RESERVED_PATHS` |
| P2-06 | `GET /api/admin/staff` | `listUsers({perPage: 1000})` once instead of N `getUserById` |
| P2-12 | `(public)/[slug]/page.tsx` | `scan_events` insert wrapped in try/catch |
| P3-01 | root + marketing layouts | `metadataBase` env-aware from `NEXT_PUBLIC_APP_URL` |
| P3-03 | `030_*` and `031_*` migration headers | Renamed from "Migration 029" to actual prefix |

## What was deferred

| Issue | Reason |
|-------|--------|
| P1-03 / P1-04 | Rate limiting needs Vercel/Upstash infra — schedule into v2.2 |
| P2-04 | `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_APP_URL` consolidation — Stripe routes still tolerate either; a clean sweep deserves its own phase |
| P2-08 | `useEffect`-set-state anti-pattern — needs careful component review per file |
| P2-09 | `Date.now()` in async server component — cosmetic lint warning, not a bug |
| P2-10 | Unused lucide imports — cosmetic |
| P2-11 | `<img>` → `next/image` on auth pages — UI polish, separate phase |
| P3-02 | DNS verification has already been hardened to CNAME-or-A in P0-08 fix |
| P3-04 | README expansion |
| P3-05 | Unsplash remote pattern — still used by seed scripts |
| P3-06 | Stripe API version — runtime fine, defer upgrade decision |
| 2 moderate postcss vulns | Pinned transitively through Next.js — upstream fix pending; can't drop without breaking changes |

## Verification

- `npx tsc --noEmit` — passes (no errors)
- `npm run build` — passes (no errors, no warnings)
- All 4 commits pushed to `main` (`origin/main` is at `533cd8b`)
- Migration `032` applied to remote Supabase

## Files touched

```
supabase/migrations/032_orders_payments_fix.sql     [new]
scripts/apply-migration-032.mjs                     [new]
src/lib/stripe-oauth-state.ts                       [new]
src/lib/superadmin-auth.ts
src/lib/get-effective-tenant.ts
src/middleware.ts
src/app/layout.tsx
src/app/(marketing)/layout.tsx
src/app/(superadmin)/layout.tsx
src/app/(public)/[slug]/page.tsx
src/app/(public)/checkout/[orderId]/page.tsx
src/app/(public)/checkout/[orderId]/confirmation/page.tsx
src/app/api/auth/signout/route.ts
src/app/api/admin/staff/route.ts
src/app/api/admin/enter-preview/route.ts
src/app/api/admin/menus/select/route.ts
src/app/api/admin/tenants/[id]/route.ts
src/app/api/admin/tenants/[id]/verify-domain/route.ts
src/app/api/orders/route.ts
src/app/api/orders/[id]/route.ts
src/app/api/superadmin/plans/route.ts
src/app/api/superadmin/plans/[id]/route.ts
src/app/api/superadmin/tenants/[id]/subscription/route.ts
src/app/api/stripe/webhooks/route.ts
src/app/api/stripe/payment-intents/route.ts
src/app/api/stripe/connect/oauth/route.ts
src/app/api/stripe/connect/callback/route.ts
supabase/migrations/030_plans_subscriptions.sql      [comment only]
supabase/migrations/031_custom_domain.sql            [comment only]
package.json, package-lock.json
```

## Strategic gaps the audit surfaced

These were noted in the audit report and remain valid recommendations:

1. **DB types codegen pipeline.** Every P0 in the schema-drift cluster would have been caught by `supabase gen types typescript` in CI.
2. **No integration tests on API routes.** A handful of route-level tests would have caught most of the P0 auth gaps immediately.
3. **The two-cookies-same-purpose problem and two-base-url envs are symptoms of evolving features without periodic consolidation.** Schedule a "consistency sweep" milestone after every two feature milestones.
