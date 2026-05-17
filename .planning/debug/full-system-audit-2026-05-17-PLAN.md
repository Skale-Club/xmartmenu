---
plan_for: full-system-audit-2026-05-17
created: 2026-05-17
mode: autonomous-overnight
---

# Remediation Plan — Full System Audit 2026-05-17

## Strategy

All 11 P0 + 9 P1 + selected P2/P3 will be fixed in a single autonomous overnight session. Work is split into 4 waves; each wave is internally parallel but waves are sequential because later waves depend on earlier schema/code.

## Wave 1 — Database migration (foundation)

**File:** `supabase/migrations/032_orders_payments_fix.sql` (new)

Schema changes required:
- `orders.payment_intent_id TEXT UNIQUE` (new column)
- `orders` status check: extend allowed values to include `paid`, `payment_failed`
- `processed_stripe_events`: rename `stripe_event_id` → `event_id`, add `event_type TEXT`
- `stripe_connections`: add `disconnected_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`
- `tenant_subscriptions`: add `cancel_at_period_end BOOLEAN DEFAULT false`

**Total unit decision:** Keep `orders.total NUMERIC(10,2)` as dollars. Patch Stripe-touching code to convert to cents via `Math.round(order.total * 100)`. Safer than data migration.

## Wave 2 — Security fixes (parallel)

Independent edits, can apply simultaneously:

- **A**: `src/app/api/admin/tenants/[id]/route.ts` — Remove `force_verified` short-circuit (P0-09)
- **B**: `src/app/api/admin/tenants/[id]/verify-domain/route.ts` — Add `getEffectiveTenant` guard + CNAME-based DNS check (P0-08, P3-02)
- **C**: `src/app/api/orders/route.ts` — Add auth on GET (P0-07), server-side price resolution on POST (P2-07)
- **D**: `src/app/api/orders/[id]/route.ts` — Add auth on PATCH, use URL `[id]` (P0-06)
- **E**: `src/app/api/superadmin/plans/route.ts` + `[id]/route.ts` — Add `assertSuperadmin` (P0-10)
- **F**: `src/app/api/superadmin/tenants/[id]/subscription/route.ts` — Add `assertSuperadmin` (P0-11)
- **G**: `src/lib/superadmin-auth.ts` + `src/lib/get-effective-tenant.ts` — Use `normalizeRole` (P1-08, P1-09)
- **H**: Cookies: add `secure: NODE_ENV==='production'` to `enter-preview/route.ts` and `menus/select/route.ts` (P1-06)

## Wave 3 — Stripe code fixes (parallel)

- **I**: `src/app/api/stripe/webhooks/route.ts` — Use `createServiceClient()`, return 500 on errors, fix column names (P0-01, P0-02, P2-05)
- **J**: `src/app/api/stripe/payment-intents/route.ts` — Use `Math.round(order.total * 100)` instead of `total_cents`; verify order ownership (P0-03, P1-02)
- **K**: `src/app/api/stripe/connect/oauth/route.ts` — Fix `/login` → `/auth/login` (P2-02); HMAC-sign state (P1-01)
- **L**: `src/app/api/stripe/connect/callback/route.ts` — Verify HMAC signature on state (P1-01)
- **M**: `src/app/(public)/checkout/[orderId]/page.tsx` + confirmation — Fix `total_cents` reads, fix broken hrefs `/menu/${slug}` → `/${slug}` (P0-03, P2-01)

## Wave 4 — Polish (parallel)

- **N**: `npm install next@16.2.6` (P0 npm audit)
- **O**: Migration comment headers — `030_*` and `031_*` say "029" (P3-03)
- **P**: Replace `<a href=/api/auth/signout>` with POST form (P1-07)
- **Q**: `next.config.ts` — remove `images.unsplash.com` if unused (P3-05)
- **R**: `src/app/layout.tsx` + `(marketing)/layout.tsx` — `metadataBase` from env var (P3-01)

## Deferred (out of scope)

- P1-03 / P1-04 rate limiting — requires Vercel/upstash setup, defer to v2.2
- P1-05 default staff password — remove fallback (do in wave 4)
- P2-06 N+1 staff query — fix in wave 4
- P2-08 set-state-in-effect anti-pattern — needs careful component review, defer
- P2-11 `<img>` → next/image — defer to UI polish phase

## Verification

After each wave:
1. `npx tsc --noEmit` (must pass)
2. `npm run lint` (no new errors)

Final:
3. `npm run build` (must succeed)
4. Commit per-wave + push to main
