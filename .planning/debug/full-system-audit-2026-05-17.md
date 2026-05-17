---
status: resolved
trigger: "full-system-audit-2026-05-17"
created: 2026-05-17T00:46:00Z
updated: 2026-05-17T02:30:00Z
---

# Full System Audit — 2026-05-17

## Summary

- Files reviewed: ~80 (all API routes, middleware, supabase clients, key migrations, key pages)
- Issues found: 38 total (P0: 11, P1: 9, P2: 12, P3: 6)
- Build status: not run (tsc clean is a strong signal)
- Type check: PASS (`tsc --noEmit` exits 0)
- Lint: 150 warnings, 0 errors (most are deferred-by-config — see lint config rules)
- npm audit: 2 vulnerabilities (1 high, 1 moderate) — all in `next` and transitive `postcss`; fix = `npm install next@16.2.6`

The codebase has a single dominant theme of risk: **the v2.0 Stripe Connect monetization phases (32–34) shipped without the underlying database migration**, and several API routes that were stamped "superadmin only" in comments are entirely unauthenticated. Both classes of bug are silent — TypeScript can't see schema drift, and there is no integration test surface — so they will only surface at runtime when a real customer attempts payment or a hostile user pokes at the API.

The custom-domain feature (Phase 35, in progress) also ships with a remote authentication bypass that lets any signed-in tenant claim any domain.

Most non-payment paths look healthy. Auth, multi-tenant scoping in admin routes, RLS on core tables, onboarding, and the public menu read path are well-reasoned.

---

## P0 — Critical (security, data loss, broken feature)

### P0-01 — Stripe webhook is broken (schema drift)
**File:** `src/app/api/stripe/webhooks/route.ts:44-54, 138-147`
**Evidence:** Code reads/writes `processed_stripe_events.event_id` and `processed_stripe_events.event_type`, but migration `supabase/migrations/030_plans_subscriptions.sql:78-81` defines the table with primary key `stripe_event_id` and only `processed_at`. The idempotency `.eq('event_id', eventId).single()` will throw `column "event_id" does not exist`. The upsert with `event_type` will also fail.
**Impact:** **Every Stripe webhook delivery fails**. Orders never transition to `paid`, `stripe_connections.is_active` is never reconciled with Stripe account state. Payment confirmations never reach the customer. Idempotency table never populated, so retries multiply silent failures.
**Fix:** Add a migration that renames `stripe_event_id` → `event_id` (or change code to use `stripe_event_id`) and adds an `event_type TEXT` column. Standardize on one name across DB + code + types.

### P0-02 — Stripe webhook uses cookie client, not service client
**File:** `src/app/api/stripe/webhooks/route.ts:40`
**Evidence:** `const supabase = await createClient()` — this is the cookie-bound anon-key client. Webhook requests have no cookies, so the client operates as `anon` role. The follow-up writes to `orders` (status update) and `stripe_connections` (is_active reconciliation) will fail RLS even if the idempotency column existed.
**Impact:** Even after fixing P0-01, the writes do nothing because anon cannot UPDATE `orders` or `stripe_connections`. Combined with the 200-on-error pattern in the catch block, this is invisible.
**Fix:** Use `createServiceClient()` in the webhook handler. RLS bypass is the standard pattern for service-to-service webhook handlers.

### P0-03 — `orders.payment_intent_id`, `total_cents`, `paid`/`payment_failed` status do not exist in DB
**Files:**
- `src/app/api/stripe/webhooks/route.ts:71-73, 96-98` (writes `payment_intent_id`, status `paid`/`payment_failed`)
- `src/app/api/stripe/payment-intents/route.ts:34, 63, 68-71` (reads `total_cents`, writes `payment_intent_id`)
- `src/app/(public)/checkout/[orderId]/page.tsx:51, 109, 183` (reads `total_cents`, branches on status `paid`)
- `src/app/(public)/checkout/[orderId]/confirmation/page.tsx:56, 140, 171` (same)

**Evidence:** `supabase/migrations/019_full_schema_sync.sql:130-140` defines `orders` with `total NUMERIC(10,2)` and no `payment_intent_id`. Migration `021_orders_v11_schema.sql:20-22` constrains `status` to `('pending','preparing','ready','done','cancelled')` — `paid` and `payment_failed` are CHECK violations.

**Impact:** Every payment-intent creation, every webhook payment update, and every checkout page render will throw at runtime. The entire payments feature is non-functional.

**Fix:** Add a migration `032_orders_payments.sql` that:
- Adds `payment_intent_id TEXT UNIQUE` to `orders`
- Replaces the `orders_status_check` constraint to include `paid` and `payment_failed`
- Either renames `total` → `total_cents` and converts the unit (multiply existing rows by 100 and change type to INTEGER), OR keeps `total` and changes all code to read `Math.round(order.total * 100)` for Stripe's smallest-unit API.

The two-unit approach is dangerous (existing dollar rows would be billed as cents); pick one and migrate cleanly.

### P0-04 — `stripe_connections` missing `disconnected_at`, `updated_at`, `created_at`
**Files:**
- `src/app/api/stripe/connect/disconnect/route.ts:30` (writes `disconnected_at`)
- `src/lib/stripe.ts:35-45` (TS type declares both columns)

**Evidence:** Migration `030_plans_subscriptions.sql:62-70` defines `stripe_connections` with only `id, tenant_id, stripe_account_id, scope, connected_at, is_active`.

**Impact:** Disconnect endpoint throws on `disconnected_at` write. Type definition lies to consumers.

**Fix:** Migration adds `disconnected_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()` + trigger.

### P0-05 — `tenant_subscriptions.cancel_at_period_end` missing
**File:** `src/app/api/tenant/subscription/route.ts:75`
**Evidence:** Code selects `cancel_at_period_end`. Migration 030 has no such column.
**Impact:** GET on tenant subscription throws `column tenant_subscriptions.cancel_at_period_end does not exist`. Subscription settings page broken for every tenant.
**Fix:** `ALTER TABLE tenant_subscriptions ADD COLUMN cancel_at_period_end BOOLEAN DEFAULT false;`

### P0-06 — `/api/orders/[id]` PATCH has no auth check
**File:** `src/app/api/orders/[id]/route.ts:4-37`
**Evidence:** No call to `getEffectiveTenant`, no auth.getUser, no tenant scope. Body-supplied `order_id` is used directly with the service client (which bypasses RLS).
**Impact:** Anyone in the world can change any order's status. A customer can mark their order `done` to skip the kitchen. A competitor can mark a rival's orders `cancelled` en masse. PII exposure if combined with the `GET /api/orders` issue below.
**Fix:** Require `getEffectiveTenant()`. Verify `order.tenant_id === effective.tenantId` (and forbid `customer` role). Use the URL `[id]` param, not body — current code ignores the param.

### P0-07 — `/api/orders` GET has no auth check
**File:** `src/app/api/orders/route.ts:114-141`
**Evidence:** Accepts `tenant_id` from query string and returns all orders + items for that tenant via service client. No auth verification.
**Impact:** Anyone with a tenant UUID (publicly enumerable via the public menu API) can dump every order, every customer name and phone, every order total, for any store. This is **PII leakage at scale**.
**Fix:** Require `getEffectiveTenant()` and force `tenantId = effective.tenantId` (ignore query string), block `customer` role.

### P0-08 — `/api/admin/tenants/[id]/verify-domain` has no auth check
**File:** `src/app/api/admin/tenants/[id]/verify-domain/route.ts:4-37`
**Evidence:** No auth, no tenant scope. Accepts any `custom_domain` from any caller and reports verified/not.
**Impact:** Reconnaissance + part of the custom-domain hijack chain. Combined with P0-09 it lets a malicious tenant pre-confirm any target domain.
**Fix:** Wrap with `getEffectiveTenant()` and confirm `id === effective.tenantId`. Tighten DNS check to verify CNAME points to the platform host, not just IP equality (the IP equality check is also brittle — Vercel rotates IPs).

### P0-09 — `force_verified` flag lets tenants self-verify any domain
**File:** `src/app/api/admin/tenants/[id]/route.ts:18, 27-29`
**Evidence:** The PATCH route accepts `force_verified: true` from the request body and sets `custom_domain_verified = true` with no DNS check.
**Impact:** Any store-admin can claim any custom domain (e.g., `apple.com`, a competitor's domain). Middleware at `src/middleware.ts:25-40` routes by `custom_domain` + `custom_domain_verified=true`, so the malicious tenant immediately captures traffic destined for that host. **Full subdomain hijack of the platform's routing fabric.**
**Fix:** Remove the `force_verified` body short-circuit entirely. Only set `custom_domain_verified=true` via a server-side DNS check that confirms the platform's CNAME record. Make the verification endpoint the only path to flip the flag, and tie it to the tenant via the effective-tenant guard.

### P0-10 — `/api/superadmin/plans` and `/api/superadmin/plans/[id]` have no superadmin check
**Files:**
- `src/app/api/superadmin/plans/route.ts` (POST, GET)
- `src/app/api/superadmin/plans/[id]/route.ts` (GET, PUT, DELETE)

**Evidence:** Both files do `const supabase = await createClient()` (cookie client) with no `assertSuperadmin()`. Comments in adjacent superadmin routes call out D-18 "auth guard first on every new route"; these routes ignore it.

**Impact:** Any authenticated user (including a customer who just registered through the QR quick-flow) can:
- POST a new plan with arbitrary prices
- PUT to set any existing plan's `monthly_price=0`, modify `transaction_fee_pct`, change features (e.g., grant themselves `stripe-connect` for free)
- DELETE plans (rejected only when subscriptions exist — they can still delete unused plans, but more importantly the unauthenticated read of all plans is fine)

Cookie-bound client + RLS *might* save the writes if `plans` has RLS that limits writes to service role only — but the migration only defines a SELECT policy (`Plans are viewable by authenticated users`). Plain authenticated users default to having ALL access denied for INSERT/UPDATE/DELETE under "deny by default if no policy"... **unless** RLS isn't fully restrictive. **Verify in DB**: `SELECT * FROM pg_policies WHERE tablename='plans';`. If only the SELECT policy exists, writes from authenticated users get denied → bug becomes "writes silently fail to authenticated users but the API returns 500" rather than "anyone can rewrite all pricing". Still a serious bug because the API surface is wrong, but severity drops to P1 if RLS catches it. **Treat as P0 until confirmed.**

**Fix:** Add `if (!await assertSuperadmin()) return 401` at the top of every handler. Switch to `createServiceClient()` for writes since you're already trusting the superadmin check.

### P0-11 — `/api/superadmin/tenants/[id]/subscription` PUT has no superadmin check
**File:** `src/app/api/superadmin/tenants/[id]/subscription/route.ts:47-141`
**Evidence:** Uses `createServiceClient()` (RLS bypass!) and runs PUT with no auth verification.
**Impact:** **Any unauthenticated request** can mutate any tenant's subscription overrides — set `override_monthly_price=0`, `override_transaction_fee_pct=0`, etc. Direct financial impact. Worse than P0-10 because service client bypasses RLS entirely.
**Fix:** `if (!await assertSuperadmin()) return 401` at top of GET and PUT.

---

## P1 — High (real bugs, security gaps, broken features)

### P1-01 — Stripe OAuth `state` parameter is not signed
**File:** `src/app/api/stripe/connect/oauth/route.ts:59-62` and `src/app/api/stripe/connect/callback/route.ts:38-43`
**Evidence:** `state = Buffer.from(JSON.stringify({tenantId, timestamp})).toString('base64')`. Plain base64, no HMAC, no nonce.
**Impact:** Attacker forges a `state` for a victim tenant's ID, then completes Stripe OAuth flow with their own Stripe account. The callback attaches their Stripe account to the victim's tenant — every future payment routes to the attacker's account.
**Fix:** Sign the state with HMAC-SHA256 using a server-only secret; verify signature in callback. Or use a server-side session token bound to the authenticated user, looked up in DB.

### P1-02 — `/api/stripe/payment-intents` does not verify order ownership
**File:** `src/app/api/stripe/payment-intents/route.ts:31-44`
**Evidence:** Authenticates a user but only checks `order.status === 'pending'`. No check that the requesting user has any relationship to the order.
**Impact:** An authenticated attacker can probe order IDs (UUIDs, but leaked via redirects/share links/etc) and create PaymentIntents for orders they don't own — useful for griefing (locking up `pending` orders behind unfinished Stripe sessions) or front-running real customers.
**Fix:** Either tie orders to the authenticated user (`orders.customer_user_id UUID`) and verify, or only allow this endpoint from an anonymous QR-customer session bound to the order via cookie/token issued at order creation.

### P1-03 — `/api/orders` POST has no rate limit
**File:** `src/app/api/orders/route.ts:31-112`
**Evidence:** Anonymous order creation with service client. No throttle, no captcha, no IP check.
**Impact:** Floods can populate a tenant's order list with thousands of fake orders, exhausting Supabase row quotas and disrupting kitchen operations. Each fake order also implicitly hits the auth.users table via the customer quick-register flow.
**Fix:** Add Vercel/upstream rate limit (per IP per tenant), or require client-supplied turnstile/captcha token, or require a server-issued nonce from the menu page render.

### P1-04 — `/api/auth/register` quick-customer flow creates unbounded auth.users rows
**File:** `src/app/api/auth/register/route.ts:33-77`
**Evidence:** Each call creates a fresh `customer.{ts}{rand}@xmartmenu.local` user via `service.auth.admin.createUser`. No rate limit, no captcha. Suffix collisions are theoretical but the bigger problem is volume.
**Impact:** Attacker can burn through Supabase auth quota (paid plan has hard limits) and create millions of stub users that bloat backups and `profiles` table. With a custom_domain hijack (P0-09) a victim's domain becomes an attack vector for their account.
**Fix:** Rate limit. Add a turnstile token from the menu page.

### P1-05 — `DEFAULT_STAFF_PASSWORD` fallback is weak and global
**File:** `src/app/api/admin/staff/route.ts:16`
**Evidence:** Falls back to literal `'Staff@12345'` if `DEFAULT_STAFF_PASSWORD` env not set. Returned in API response on staff create.
**Impact:** Predictable cross-install password. Combined with leaked staff email lists, an attacker can try the literal credential to gain `store-staff` access to any tenant whose admin didn't change it before staff first sign-in. Mitigated by `must_change_password=true` flag — but only if the staff member *opens* the app before the attacker does.
**Fix:** Generate a per-staff random password the same way `/api/admin/staff/[id]` PATCH does (lines 7-11). Drop the env fallback entirely.

### P1-06 — Cookies set without `secure: true`
**Files:**
- `src/app/api/admin/enter-preview/route.ts:13` — `preview_tenant_id`
- `src/app/api/admin/menus/select/route.ts:24-29` — `selected_menu_id`

**Evidence:** Both set `httpOnly: true, sameSite: 'lax'` but no `secure` flag. Production deploy is HTTPS, so browsers should still mark these `Secure` on HTTPS responses; but the missing explicit flag means downgrade attacks or proxied HTTP responses can read them.
**Impact:** The `preview_tenant_id` cookie effectively grants superadmins access to any tenant's admin panel via `getEffectiveTenant`. If exfiltrated, attacker gets admin-as-tenant. The `selected_menu_id` is lower risk.
**Fix:** `secure: process.env.NODE_ENV === 'production'`. Apply globally.

### P1-07 — `/api/auth/signout` is a GET endpoint
**File:** `src/app/api/auth/signout/route.ts:4-8`
**Evidence:** Implements `GET` handler that calls `auth.signOut()`. The sidebar uses `<a href="/api/auth/signout">` (linted: see warnings in `AdminSidebar.tsx`, `auth/login/page.tsx:74`).
**Impact:** Any external page that link-previews, prefetches, or speculatively loads the URL signs the user out. Also CSRF-prone: a third-party site loading `<img src="…/api/auth/signout">` signs out the logged-in admin.
**Fix:** Convert to POST, drive from a form button. (Bigger refactor — also fixes all the `no-html-link-for-pages` warnings.)

### P1-08 — `assertSuperadmin` skips role normalization
**File:** `src/lib/superadmin-auth.ts:49`
**Evidence:** `return profile?.role === 'superadmin' ? supabase : null`. The sibling `isSuperadminRequest` (line 15) uses `normalizeRole(profile?.role)` to handle `super-admin` and case variants. Inconsistent.
**Impact:** A superadmin whose role row is stored as `super-admin` (via the old role-utils alias) gets 401 on every superadmin API endpoint that uses `assertSuperadmin`. Cron of bugs throughout the superadmin surface.
**Fix:** Use `normalizeRole` consistently:
```ts
return normalizeRole(profile?.role) === 'superadmin' ? supabase : null
```

### P1-09 — `getEffectiveTenant` also skips role normalization
**File:** `src/lib/get-effective-tenant.ts:25`
**Evidence:** `if (profile.role === 'superadmin') {...}`. Same issue as P1-08.
**Impact:** Same — a superadmin with non-canonical role string gets treated as a regular tenant member, breaking preview-tenant mode.
**Fix:** Use `normalizeRole`.

---

## P2 — Medium (UX defects, perf, dead code, drift)

### P2-01 — Broken internal links in checkout flow
**Files:**
- `src/app/(public)/checkout/[orderId]/page.tsx:67, 92, 121, 139` — links to `/menu/${slug}` and `/confirmation/${id}`
- `src/app/(public)/checkout/[orderId]/confirmation/page.tsx:65, 72, 97, 181, 188` — same

**Evidence:** Real routes are `/${slug}` (no `/menu` prefix) and `/checkout/${orderId}/confirmation`. These hrefs 404.
**Fix:** Use `/${order.tenants.slug}` and `/checkout/${orderId}/confirmation`.

### P2-02 — `/api/stripe/connect/oauth` redirects to `/login` (404)
**File:** `src/app/api/stripe/connect/oauth/route.ts:18`
**Evidence:** Redirect target is `/login`, but the auth route is `/auth/login`. Already 404 when unauthenticated user is invoked.
**Fix:** `/auth/login`.

### P2-03 — Middleware blocked-slug list is out of sync with reserved paths
**Files:** `src/middleware.ts:4-7` vs `src/lib/marketing/reserved-paths.ts:7-13`
**Evidence:** Middleware blocks 15 slugs; reserved-paths blocks 27. Onboarding rejects 27, middleware lets 12 of them through to tenant route resolution. Existing tenants with legacy slugs (`admin`, `auth`, etc.) would shadow real routes — those routes win in Next route ordering, but the inconsistency invites future regressions.
**Fix:** Have `middleware.ts` import `RESERVED_PATHS` and use it as the source of truth.

### P2-04 — Inconsistent env var: `NEXT_PUBLIC_APP_URL` vs `NEXT_PUBLIC_BASE_URL`
**Files:** Stripe routes use `NEXT_PUBLIC_BASE_URL`; signout, QR, branding, verify-domain, middleware use `NEXT_PUBLIC_APP_URL`. `.env.example` ships both.
**Impact:** Two env vars for the same thing. Drift in production deploys is inevitable.
**Fix:** Pick one (`NEXT_PUBLIC_APP_URL` matches the larger surface). Remove the other from `.env.example`. Update Stripe code.

### P2-05 — Webhook catch-all returns 200 on error
**File:** `src/app/api/stripe/webhooks/route.ts:160-165`
**Evidence:** "Return 200 to prevent Stripe from retrying — errors are logged."
**Impact:** Hides P0-01/P0-02 failures from Stripe's retry mechanism, so silent data loss instead of loud retry. Combined with the schema drift, every webhook silently dies.
**Fix:** Return 500 for unexpected errors. Only the explicit "already processed" branch should return 200.

### P2-06 — N+1 in `/api/admin/staff` GET
**File:** `src/app/api/admin/staff/route.ts:31-38`
**Evidence:** Per-staff loop calling `service.auth.admin.getUserById(id)`. Each call is a network round-trip.
**Impact:** Slow staff lists at 20+ employees. Each page load = N requests.
**Fix:** Use `service.auth.admin.listUsers({perPage: 1000})` once and join in-memory (as `/api/superadmin/users` already does).

### P2-07 — `/api/orders` POST: total computed from client-supplied unit_price
**File:** `src/app/api/orders/route.ts:67`
**Evidence:** `total = sum(item.unit_price * item.quantity)` using values from the request body.
**Impact:** Client can submit `unit_price: 0` for a $50 product. There's no server-side resolution of the canonical price from `products` table.
**Fix:** Look up each `product_id` in DB, use the DB `price`, ignore client-supplied `unit_price`. (This also makes options/modifiers pricing trustable.)

### P2-08 — Linter set-state-in-effect anti-pattern not fixed (4 instances)
**Files:**
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx:164, 174`
- `src/components/admin/CopyMenuUrl.tsx:12`
- `src/components/menu/ProductModal.tsx:52, 64`

**Evidence:** Lint warns; rule downgraded to warning in `eslint.config.mjs:25`.
**Impact:** Cascading renders, perf hit, hard-to-reason render order. The TenantDetailClient cases also race with the parent's controlled state.
**Fix:** Initialize via `useMemo` / state initializer, or trigger from the event that should reset state. Pattern documented in React 19 docs.

### P2-09 — Lint `Date.now()` in async server component flagged
**File:** `src/app/(superadmin)/overview/page.tsx:10`
**Evidence:** React purity rule warning. The lint rule is downgraded but the call is fine in async server components (rendered once per request).
**Fix:** Optional. Acknowledge in code comment with `// react-hooks/purity` disable, or move into a derived helper to silence.

### P2-10 — Dead/unused lucide-react imports across superadmin clients
**Files:** `PlansClient.tsx:18` (`ChevronRight`), `SettingsClient.tsx:8` (`Palette`), `UsersClient.tsx:14, 16` (`MoreVertical`, `CheckCircle2`)
**Fix:** Run `eslint --fix` after enabling the unused-imports rule.

### P2-11 — `<img>` tags on auth pages (not `next/image`)
**Files:** `src/app/auth/login/page.tsx:73`, `pending/page.tsx:10`, `register/page.tsx:74`, `AdminSidebar.tsx:113`
**Impact:** Larger LCP, no automatic webp/srcset.
**Fix:** Replace with `next/image`. Logo is in `public/`, so straightforward.

### P2-12 — Public menu page does ingredient hydration N+1-like
**File:** `src/app/(public)/[slug]/page.tsx:96-108`
**Evidence:** Single batched `in(product_id, productIds)` query — actually fine. But the `scan_events.insert` fire-and-forget on line 112 is awaited as a promise but its rejection is swallowed by `.then(() => {})` without a `.catch`. If the insert fails the promise rejects unhandled. Minor.
**Fix:** Add `.catch(() => {})` to swallow gracefully, or `void` the promise.

---

## P3 — Low (polish, consistency, minor cleanups)

### P3-01 — Metadata `metadataBase` references `xmartmenu.com` but deploy is `xmartmenu.skale.club`
**Files:** `src/app/layout.tsx:20`, `src/app/(marketing)/layout.tsx:8,13`
**Fix:** Use env var (`NEXT_PUBLIC_APP_URL`) and fall back to `xmartmenu.skale.club`. Open Graph URL too.

### P3-02 — Verify-domain DNS check uses IP equality
**File:** `src/app/api/admin/tenants/[id]/verify-domain/route.ts:32`
**Evidence:** `verified = address === platformAddr`. Vercel rotates IPs (and serves from a CDN with multiple A records).
**Fix:** Check that domain has a CNAME pointing to `xmartmenu.skale.club` (use `dns.resolveCname`) or that one of its A records matches one of the platform's A records (use `dns.resolve4`).

### P3-03 — Migration filename comments out of sync
**Files:** `030_plans_subscriptions.sql:1` ("Migration 029"), `031_custom_domain.sql:1` ("Migration 029")
**Fix:** Update header comments to match filename prefixes.

### P3-04 — README is minimal
**File:** `README.md` (40 lines)
**Fix:** Document local dev setup, env vars required, supabase migration workflow. Or at minimum link to `.planning/` for project history.

### P3-05 — `next.config.ts` allows `images.unsplash.com` remote pattern
**File:** `next.config.ts:14-18`
**Evidence:** Open whitelist for any path. Likely from initial scaffold / seed data.
**Fix:** Restrict to specific Unsplash collection paths if used in marketing seed images, or remove entirely if no longer needed.

### P3-06 — Stripe API version pinned to `2026-04-22.dahlia`
**File:** `src/lib/stripe.ts:21`
**Impact:** Pinning is good, but the version is over a year old (today is 2026-05-17). Check changelogs before next Stripe SDK upgrade.

---

## Recommendations

### Fix tonight (P0 storm — payments and routing fabric)

1. **Add migration `032_orders_payments.sql`** for `orders.payment_intent_id`, `total_cents` (or keep `total` and patch all code), status check loosening, and `tenant_subscriptions.cancel_at_period_end`. Also fix `processed_stripe_events` schema (P0-01) and `stripe_connections` columns (P0-04).
2. **Fix the Stripe webhook** to use `createServiceClient()` (P0-02) and align column names (P0-01).
3. **Patch the four broken-auth API routes** with `assertSuperadmin()` / `getEffectiveTenant()` checks:
   - `src/app/api/orders/[id]/route.ts` PATCH
   - `src/app/api/orders/route.ts` GET
   - `src/app/api/superadmin/plans/route.ts` POST + `[id]/route.ts` PUT/DELETE
   - `src/app/api/superadmin/tenants/[id]/subscription/route.ts` GET + PUT
   - `src/app/api/admin/tenants/[id]/verify-domain/route.ts` POST
4. **Remove `force_verified` short-circuit** (P0-09) from `src/app/api/admin/tenants/[id]/route.ts`.
5. **Run `npm install next@16.2.6`** to clear the 1 high + 1 moderate npm-audit vulnerabilities (auto-fix available).

### Defer to a follow-up

6. P1 cluster: HMAC the Stripe OAuth state, verify payment-intent ownership, rate-limit orders and customer registration, drop the default-staff-password fallback, mark cookies secure, convert signout to POST, normalize role checks in `assertSuperadmin` and `getEffectiveTenant`.
7. P2 cluster: fix the broken checkout/confirmation hrefs (these are user-facing 404s on every successful payment), unify env vars and reserved-paths sources, fix the webhook 200-on-error, replace `<img>` with `next/image` for LCP wins.
8. P3 polish: migration comment fixes, README expansion, `metadataBase` env-aware.

### Strategic — surface gaps that enabled this

- **No DB-types codegen pipeline.** Schema drift on `total_cents`, `payment_intent_id`, `disconnected_at`, `event_id`, `cancel_at_period_end` would have been caught by `supabase gen types typescript` against the live DB. Adding this to CI would have failed builds on every P0 above.
- **No integration test for any API route.** Type system can't see "this column doesn't exist" or "this endpoint has no auth." A handful of route-level integration tests (vitest + supertest against a local Supabase) would have caught P0-02, P0-03, P0-06, P0-07, P0-08, P0-10, P0-11 immediately.
- **`auditReportVersion` shows `205` prod deps.** Running `npx knip` would surface unused deps (`@aws-sdk/*` may be unused if storage provider is unset; check `STORAGE_PROVIDER` usage).
- **The two-cookies-same-purpose problem in middleware (`preview_tenant_id` + `selected_menu_id`) and the two-base-url envs are symptoms of evolving features without periodic consolidation.** Schedule a "consistency sweep" milestone after every two feature milestones.
