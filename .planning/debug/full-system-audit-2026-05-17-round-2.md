---
status: complete
trigger: "full-system-audit-round-2-2026-05-17"
created: 2026-05-17
updated: 2026-05-17
---

# Full System Audit Round 2 — 2026-05-17

## Summary

- Files reviewed: ~50 (API routes, middleware, auth lib, public pages, checkout, KDS, RLS, types vs DB)
- DB queries run: 40+ (RLS policies, FKs, columns, constraints, orphans, triggers, functions, storage policies)
- Issues found: **29 total** (P0: 8, P1: 9, P2: 9, P3: 3)
- Build/typecheck: `tsc --noEmit` PASS — none of these issues are caught by the compiler. That is exactly the problem.
- New surface compared to round 1: live DB integrity, RLS policy detail, schema-vs-types drift, state machine logic (orders, KDS), middleware regression after Wave 4, public/checkout regression after Wave 3, password entropy, ISR scan analytics, role CHECK constraint vs `customer` role usage.

The most consequential finding is **P0-01 (middleware kills the entire app)** — Wave 4's "P2-03 fix" expanded `BLOCKED_TENANT_SLUGS` to include every named route group (`auth`, `api`, `dashboard`, `menu`, `menus`, `settings`, `overview`, `tenants`, `users`, `onboarding`, `admin`, `superadmin`), so the middleware now returns `{ error: 'Not found' }` (404) before routing resolves any of them. The original code (commit `f12c54b`) explicitly excluded these in a comment that read *"only add slugs here that have NO named file"* — Wave 4 ignored that and unified the list with `RESERVED_PATHS` (which has a different purpose). **Every admin URL, every superadmin URL, every API endpoint including the Stripe webhook, and the auth login page itself currently 404.** This regression is fresh on `main` (commit `533cd8b`).

After that, the dominant theme is the same as round 1: **silent DB drift catches new code in production-only failure paths**. Three independent code paths upsert `profile.role = 'customer'` (register customer, downgrade staff, superadmin user PATCH) but the `profiles_role_check` constraint does not allow `'customer'`. Two more code paths still read `order.total_cents` after the Wave 3 fix that was supposed to delete those reads. Disconnect uses the cookie client against a table whose only RLS policies are SELECT.

The third theme is **state-machine logic that wasn't updated for the new statuses**: KDS only listens to `INSERT` events (so webhook-driven status changes never refresh), `NEXT_STATUS`/`STATUS_COLORS` ignore `paid` and `payment_failed`, and the order PATCH endpoint's `VALID_STATUSES` whitelist explicitly excludes them so a tenant admin cannot transition a paid order to `preparing`.

The fourth theme is **inputs the audit didn't open**: I confirmed RLS is enabled on every public table, no orphan order_items / order-tenant mismatches / option-group cross-tenant rows, no duplicate default menus, no invalid tenant slugs. The DB side is largely clean — the bugs are all in the code-to-DB contract.

---

## P0 — Critical (security, data loss, broken feature)

### P0-01 — Middleware blocks every admin/superadmin/api route on `main`
**File:** `src/middleware.ts:7-13`
**Evidence:** The `BLOCKED_TENANT_SLUGS` set returned by middleware-level 404 includes `'auth', 'api', 'onboarding', 'dashboard', 'menu', 'settings', 'overview', 'tenants', 'users', 'admin', 'superadmin', 'sitemap', 'robots'`. The middleware's matcher (`src/middleware.ts:74-76`) excludes only static asset extensions and `_next/*`. Therefore `GET /api/stripe/webhooks`, `GET /dashboard`, `GET /auth/login`, etc. all hit `firstSegment === 'api'|'dashboard'|'auth'|…` → `BLOCKED_TENANT_SLUGS.has(firstSegment)` is true → returns `NextResponse.json({ error: 'Not found' }, { status: 404 })`.

Original commit `f12c54b` deliberately excluded these named routes with an inline comment: *"Named App Router routes (auth/, api/, dashboard/) self-resolve via file system and never reach [slug] — only add slugs here that have NO named file."* Wave 4's audit-remediation commit `533cd8b` (Sun May 17, 2026) ignored that comment and merged the list with `RESERVED_PATHS` because the audit report called this "out of sync" — but the two sets have **opposite** purposes: `BLOCKED_TENANT_SLUGS` is "slugs to treat as not-a-tenant", `RESERVED_PATHS` is "slugs no tenant may register". Named routes belong only in the latter.

**Impact:** The entire admin panel, superadmin panel, all API routes (including the Stripe webhook), all auth pages, the onboarding flow, robots.txt, and sitemap.xml all return `{"error":"Not found"}` with 404. Stripe will mark the webhook endpoint dead within hours, then deliver no further events. End-of-the-world.

**Fix:** Revert `BLOCKED_TENANT_SLUGS` to the original set from `f12c54b`: slugs that are pure marketing copy with no named route. The line that should be there:
```ts
const BLOCKED_TENANT_SLUGS = new Set([
  'pricing', 'features', 'about', 'faq', 'blog', 'demo', 'help', 'support',
  'pt', 'en', 'legal', 'privacy', 'terms', 'contact', 'careers',
])
```
Drop `auth`, `api`, `onboarding`, `dashboard`, `menu`, `settings`, `overview`, `tenants`, `users`, `admin`, `superadmin`, `sitemap`, `robots`. They are protected by file-system routing, not by the slug guard. The "consistency with RESERVED_PATHS" goal can be achieved with a code comment, not by unifying the data.

### P0-02 — `profiles_role_check` rejects `'customer'`; three code paths upsert it
**Files:**
- `src/app/api/auth/register/route.ts:53` — quick-customer QR flow
- `src/app/api/admin/staff/[id]/route.ts:87` — staff DELETE downgrade-to-customer
- `src/app/api/superadmin/tenants/[id]/staff/[staffId]/route.ts:66` — superadmin staff DELETE
- `src/app/api/superadmin/users/[id]/route.ts:18,40,46` — PATCH allows role=customer, normalizes tenant to null

**Evidence:** DB CHECK constraint (verified via `pg_constraint`): `profiles_role_check CHECK ((role = ANY (ARRAY['superadmin'::text, 'store-admin'::text, 'store-staff'::text, 'admin'::text])))`. The constraint allows `'admin'` (legacy alias) but **does not allow `'customer'`**. Confirmed empirically: `INSERT INTO profiles (id, role) VALUES (gen_random_uuid(), 'customer')` returns *"new row for relation \"profiles\" violates check constraint \"profiles_role_check\""*.

Live DB shows **4 orphan store-admin profiles with `tenant_id IS NULL`** — Ellen Laurino, Ana Paula Silva, Carlos Eduardo, Mariana Costa — all dated 2026-04-22. These are the quick-customer-registration users: the `handle_new_user` trigger created their profile with the column default `role = 'store-admin'`, the followup upsert from the API tried to set `role = 'customer'`, that upsert failed silently against the CHECK, and the profile stayed in the default state.

**Impact:**
- Quick customer register flow appears to work (user is created, signed in) but the profile keeps `role='store-admin'` with no tenant. They are not a customer in the data model — they accidentally have admin role with no tenant scope, so calls to `getEffectiveTenant()` for them return `{ tenantId: null, ... }`, which is then crashed by `effective!` non-null assertions elsewhere.
- Staff DELETE silently fails to demote: the error from `update()` is not checked (no `if (error) return`), so the API returns `{ ok: true }` while the staff row stays unchanged. The "deleted" staff member still has access on their next login.
- Superadmin user PATCH with `role: 'customer'` returns 500 with the raw DB error message.

**Fix:** Add `'customer'` to the CHECK constraint (and add it back to TS while you're there if you intend customers to exist as a role):
```sql
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['superadmin','store-admin','store-staff','customer']));
-- 'admin' alias is dead — normalizeRole maps it to store-admin
```
Decide whether the customer flow is supposed to exist at all: if yes, fix the constraint + backfill the 4 orphans with `role='customer'`. If no, delete the quick-customer code path.

Also: in the staff DELETE handlers, check the update error and return 500 instead of silently `{ok:true}`.

### P0-03 — Checkout confirmation still reads non-existent `order.total_cents`
**File:** `src/app/(public)/checkout/[orderId]/confirmation/page.tsx:165`
**Evidence:** Wave 3 in `0bfb9d1` claimed to have switched all `total_cents` reads to `total` (dollars) + `Math.round(x*100)`. Confirmed via `grep -rn "total_cents" src/`: **one remaining occurrence**, at line 165: `R$ {(order.total_cents / 100).toFixed(2)…}`. Reached when the user lands on `/checkout/:id/confirmation` without a `redirect_status` query param (the post-payment poll-the-DB branch). `order.total_cents` is `undefined` → `undefined / 100` → `NaN` → "R$ NaN".
**Impact:** Every customer who refreshes the confirmation page (or arrives via a deep link) sees `R$ NaN` instead of the order total. The "Return to Menu" link below is also broken (see P0-04).
**Fix:** Change to `(Number(order.total) || 0).toFixed(2).replace('.', ',')` to match the same-file branch at line 56.

### P0-04 — Checkout/confirmation pages still link to `/menu/${slug}` (broken in two more places)
**Files:**
- `src/app/(public)/checkout/[orderId]/page.tsx:141`
- `src/app/(public)/checkout/[orderId]/confirmation/page.tsx:175`

**Evidence:** Wave 3 (P2-01) claimed to fix all `/menu/${slug}` links to `/${slug}`. The success branch in confirmation (line 65) and the not-found branch in checkout (line 37, uses `/`) are fixed. But the **fallback "Return to Menu" link** in confirmation (line 175) and the **"Back to menu" link at the top of the checkout page** (line 141) still use `/menu/${slug}` → 404.
**Impact:** Customer in the post-payment-poll state or pre-payment review state clicks back to menu → 404. Same UX outcome as the round-1 bug.
**Fix:** Replace both with `/${order.tenants.slug}`.

### P0-05 — Order PATCH endpoint can't transition `paid` orders forward
**File:** `src/app/api/orders/[id]/route.ts:5`
**Evidence:** `const VALID_STATUSES = ['pending', 'preparing', 'ready', 'done', 'cancelled'] as const` — the DB CHECK constraint was loosened to include `'paid'` and `'payment_failed'`, but the API whitelist was not. So when a customer pays for an order (status → `paid` via webhook) and the kitchen tries to advance it to `preparing`, the request body has `status: 'preparing'` which passes the validate, BUT the KDS dashboard never refreshes after webhook (see P0-06), so the kitchen never sees the paid status in the first place. Combined: paid orders are stuck.

Also, on the server side, after a payment succeeds the kitchen needs to manually advance — but the existing transitions logic in `OrdersClient.tsx:26-32`:
```ts
const NEXT_STATUS: Record<string, string | null> = {
  pending: 'preparing', preparing: 'ready', ready: 'done', done: null, cancelled: null,
}
```
has no entry for `paid` or `payment_failed`, so the "advance" button is hidden. **A paid order has no UI affordance to start preparing it.**

**Impact:** Every successfully-paid order becomes a dead row in the kitchen queue. Manual intervention required (direct SQL or admin DB tool).
**Fix:** Add `'paid'` and `'payment_failed'` to `VALID_STATUSES`. In `OrdersClient.tsx`, extend `NEXT_STATUS` (`paid` → `preparing`, `payment_failed` → `cancelled` or null), `STATUS_COLORS`, and `ADVANCE_LABEL`. Decide the canonical state machine: most likely `pending → paid → preparing → ready → done`, with `payment_failed` as a terminal pre-prep state.

### P0-06 — KDS realtime subscribes to INSERT only; missing UPDATE listener
**File:** `src/app/(admin)/orders/OrdersClient.tsx:221-255`
**Evidence:** The realtime channel filter is `event: 'INSERT'`. The Stripe webhook updates `orders.status` from `pending → paid` (and writes `payment_intent_id`). Those are UPDATE events. The KDS never sees them.

The 15s polling at line 257-266 *would* eventually catch up, but the URL is `/api/orders?tenant_id=${tenantId}` — after the P0-07 fix in round 1, the GET endpoint ignores the query string and uses `getEffectiveTenant()`, so it works for the same tenant, but the URL pattern is now meaningless. (Minor: still works.)

**Impact:** Up to 15s lag between payment success and KDS update. Combined with P0-05 (no UI for `paid` state), the order looks stuck even after the polling catches up.
**Fix:** Add a second realtime subscription with `event: 'UPDATE'` (or `event: '*'`) on the same `orders` channel. Reconcile the order by id in `setOrders` for UPDATEs.

### P0-07 — Stripe disconnect uses cookie client; no UPDATE policy on `stripe_connections`
**File:** `src/app/api/stripe/connect/disconnect/route.ts:26-35`
**Evidence:** `const { data, error } = await supabase.from('stripe_connections').update({ is_active: false, disconnected_at: new Date().toISOString() })…` where `supabase` is the cookie-bound anon client from `createClient()`. Live DB has only **two SELECT policies** on `stripe_connections` (one for superadmin, one for tenant owner) and **zero INSERT/UPDATE/DELETE policies**. RLS denies the UPDATE silently → `.select('id').single()` returns "no rows returned" → endpoint returns 500.
**Impact:** Disconnect endpoint always fails. Users can't disconnect their Stripe account through the UI.
**Fix:** Use `createServiceClient()` in this route (same as `connect/callback` does), since the auth check on tenant ownership already happened via `getEffectiveTenant()`.

### P0-08 — ISR caches `(public)/[slug]/page.tsx` for 60s, so scan_events fire-and-forget runs at most every 60s, not per visit
**File:** `src/app/(public)/[slug]/page.tsx:1, 114-116`
**Evidence:** `export const revalidate = 60` at the top of the page, then the `scan_events.insert` is inside the page body — which Next will execute only on cache miss. Live DB shows `scan_events.count = 2246`. The marketing claim of the analytics feature is "every QR scan is recorded".
**Impact:** Scan analytics undercount QR scans by 1–N× depending on traffic. A restaurant with 200 visits/hr records ~1/min instead of 200/min. The dashboard scan count is meaningless.
**Fix:** Move the scan_events insert into a separate route handler (`POST /api/public/scan?tenant=…`) and have the client fire it via `<script>` on page load, or use Next's `unstable_noStore()` only around the insert. The page can remain ISR for the menu read.

---

## P1 — High (real bugs, broken features, security gaps)

### P1-01 — `Math.random()` used for passwords and OAuth-adjacent suffixes
**Files:**
- `src/app/api/admin/staff/route.ts:22` — staff create password
- `src/app/api/admin/staff/[id]/route.ts:10` — staff password reset
- `src/app/api/superadmin/tenants/[id]/staff/[staffId]/route.ts:9` — superadmin staff
- `src/app/api/superadmin/tenants/route.ts:7` — tenant create
- `src/app/api/auth/register/route.ts:10` — customer email suffix (collision risk only)

**Evidence:** All these generate 12-char passwords with `PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)]`. `Math.random()` is a PRNG, not cryptographic. V8's xorshift128+ state is recoverable from a small sample.
**Impact:** A staff password reset, captured timing data on the request, and the alphabet (54 chars) all add up to attacker recovery being possible from a colluding member who can sample many resets. Lower-priority than the audit-1 plain-text default password it replaced, but the round-1 fix introduced a new (smaller) flaw.
**Fix:** Use `crypto.randomInt(0, PASSWORD_CHARS.length)` (Node 18+) per character, or `crypto.randomBytes(12).toString('base64url').slice(0,12)`.

### P1-02 — `admin/tenants/[id]` PATCH non-null-asserts effective tenant
**File:** `src/app/api/admin/tenants/[id]/route.ts:10-11`
**Evidence:** `const effective = await getEffectiveTenant(); const { tenantId } = effective!`. If unauthenticated, `effective` is null and the destructure throws `TypeError: Cannot destructure property 'tenantId' of 'undefined' as it is undefined.` The 500 catch returns generic error.
**Impact:** Unauthenticated POST to this URL returns 500 instead of 401. Information leak (server error vs auth error). And the surrounding code never explicitly checks `if (!effective) return 401` — relies on TS to scream, but `!` silences TS too.
**Fix:** `if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })` before destructuring. Also wrap the whole handler in try/catch consistent with siblings.

### P1-03 — `tenants.plan` legacy column and `tenant_subscriptions` table are not kept in sync
**Evidence:** Live DB shows:
- `tenants_plan_check CHECK ((plan = ANY (ARRAY['free','pro','enterprise'])))` — legacy taxonomy
- `plans` table has slugs `menu`, `orders`, `payments` — actual taxonomy
- The one production tenant has `plan = 'pro'` (legacy) and a tenant_subscriptions row with `plan_id` referring to plan `33333333-…` — which the plans data shows is one of menu/orders/payments. The two systems disagree.
- `onboarding/route.ts:122` inserts `plan: 'free'` (legacy) but does **not** create a `tenant_subscriptions` row.

**Impact:** Onboarding produces a tenant with `tenants.plan='free'` and NO tenant_subscriptions row → `getTenantPlan()` returns null → every code path checking `plan.features.includes(...)` (Stripe-Connect, Payments, Orders) returns false → the tenant cannot enable any feature they paid for. Customer support nightmare.
**Fix:** Either (a) delete `tenants.plan` entirely and use `tenant_subscriptions` as the source of truth, then update onboarding to insert a default `tenant_subscriptions` row pointing at the free plan (or whichever is the entry-level plan id), OR (b) keep `tenants.plan` as a denormalized snapshot kept in sync via trigger from `tenant_subscriptions`. Approach (a) is cleaner.

### P1-04 — `tenant_subscriptions.plan_id` FK is `NO ACTION` on delete; orphans tenant subscriptions if a plan is removed
**Evidence:** From `information_schema.referential_constraints`: `tenant_subscriptions_plan_id_fkey` has `delete_rule = NO ACTION`. The superadmin/plans DELETE handler at `src/app/api/superadmin/plans/[id]/route.ts` already detects subscriptions and rejects, BUT only because that handler is one path. Any future direct SQL or service-client DELETE will hit `update or delete on table "plans" violates foreign key constraint`.
**Impact:** Low likelihood in normal use because the API rejects; the FK is a backstop. Worth a `ON DELETE RESTRICT` change so the rule is enforced at the DB layer (matching the code) and `ON DELETE CASCADE` is explicitly avoided.
**Fix:** `ALTER TABLE tenant_subscriptions DROP CONSTRAINT tenant_subscriptions_plan_id_fkey; ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT;`

### P1-05 — `scan_events.tenant_id` FK is `NO ACTION`; will block tenant deletion
**Evidence:** `scan_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)` — no ON DELETE clause means `NO ACTION` (PostgreSQL default).  Other tenant-scoped FKs all use CASCADE; this one is the lone exception. Live DB shows `scan_events.count = 2246`.
**Impact:** A superadmin who tries to delete a tenant will hit `update or delete on table "tenants" violates foreign key constraint "scan_events_tenant_id_fkey"` because 2246 rows reference it. Currently no UI for tenant deletion exists, but the moment one ships this breaks.
**Fix:** `ALTER TABLE scan_events DROP CONSTRAINT scan_events_tenant_id_fkey; ALTER TABLE scan_events ADD CONSTRAINT scan_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;` (consistent with the rest of the schema).

### P1-06 — `platform_settings` has RLS enabled but no policies → table is effectively read-only via service role only
**Evidence:** `RLS_BUT_NO_POLICIES` query returned a single row: `platform_settings`. Combined with the fact that the table has one row (`SELECT * FROM platform_settings LIMIT 5` showed it), the only access path that works is the service-role client (which bypasses RLS).
**Impact:** Anonymous SSR reads of platform settings (e.g., from marketing landing page or `(public)` route) will return empty unless they use the service client. Likely working today only because consumers use the service client; will break the moment a cookie-bound client is added.
**Fix:** Either add an explicit `CREATE POLICY "Platform settings publicly readable" ON platform_settings FOR SELECT USING (true);` or document that this table is service-role-only. Pick one and write a comment in the migration.

### P1-07 — Public menu page omits OG image when logo_url is null, producing broken `images: ['']`
**File:** `src/app/(public)/[slug]/page.tsx:37`
**Evidence:** `images: [(tenant.tenant_settings as any)?.logo_url ?? '']` — when no logo is set, this becomes `images: ['']`, which Next renders as `<meta property="og:image" content="" />`. Social-media link previews show a broken thumbnail.
**Impact:** First impressions on WhatsApp / Twitter / Facebook for tenants without a logo.
**Fix:** Conditionally include the image: `openGraph: { title: …, ...(logoUrl ? { images: [logoUrl] } : {}) }`. Or default to a platform-level fallback (the `platform_settings.menu_footer_brand` could anchor a static brand image).

### P1-08 — `TypeScript ProcessedStripeEvent` type out of sync with DB after Wave 1
**File:** `src/types/database.ts:70-73`
**Evidence:** Type still says:
```ts
export interface ProcessedStripeEvent {
  stripe_event_id: string  // wrong; column is event_id since migration 032
  processed_at: string
}
```
Live DB shows `processed_stripe_events` has columns `event_id` (PK), `event_type`, `processed_at` — the `stripe_event_id` column was renamed in migration 032.
**Impact:** Anyone who imports `ProcessedStripeEvent` and uses `.stripe_event_id` will get a TS-clean call that throws at runtime. Currently no consumers, but it's a landmine.
**Fix:** Update the type to match:
```ts
export interface ProcessedStripeEvent {
  event_id: string
  event_type: string
  processed_at: string
}
```
Also: `Order` type is missing `payment_intent_id` (added in migration 032). And `UserRole` still includes `'customer'` which the DB rejects (see P0-02 for the resolution direction).

### P1-09 — `is_superadmin()` SQL function does not recognize `super-admin` legacy alias
**File:** Postgres function definition (verified via `pg_get_functiondef`)
**Evidence:**
```sql
CREATE FUNCTION is_superadmin() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin')
$$;
```
Compared to `normalizeRole()` in TS which maps `'super-admin' → 'superadmin'`. The DB CHECK constraint does **not** include `'super-admin'` (only `superadmin`/`store-admin`/`store-staff`/`admin`), so practically there are zero rows with `'super-admin'` — the TS normalization branch is dead code. But if anyone ever inserts via direct SQL with that alias, RLS would deny their superadmin powers, which is a confusing failure mode.
**Impact:** Minor — dead alias branch in TS. Worth either removing the alias from `normalizeRole` (since DB makes it impossible) or expanding the DB function and CHECK to accept it (for future-proofing).
**Fix:** Decide canonical role spelling. Either (a) delete `if (role === 'super-admin')` from `role-utils.ts` (current DB enforces this anyway), or (b) keep TS lenient and update `is_superadmin()` SQL to `role IN ('superadmin','super-admin')`. Option (a) is simpler.

---

## P2 — Medium (UX defects, perf, dead code, drift)

### P2-01 — Public policies on tenant-scoped tables use `USING (true)` and `WITH CHECK (true)`
**Evidence:** Queried `pg_policies` for policies with literal `true`:
- `order_items_public_insert` — anyone can insert any order_items
- `orders_public_insert` — anyone can insert orders
- `scan_events.scan_insert_anon` — anonymous scan insert (intended)
- `product_ingredients.Public read product_ingredients` — exposes per-tenant ingredient catalog publicly
- `product_options.options_public_read`, `product_option_groups.option_groups_public_read` — same

**Impact:** The order/order_items public-insert policies enable the public order-from-QR flow, but they don't validate tenant_id against the order's tenant_id (or the orders.tenant_id against an active tenant). Combined with the missing rate limit (round 1 P1-03 deferred), this is the spam vector. The product_ingredients/options public reads leak per-tenant catalog data (ingredient names, option prices) to anonymous callers indiscriminately — fine for an active product, but if a product is set is_available=false the ingredient/option rows still read.

**Fix:** For `orders_public_insert` and `order_items_public_insert`, tighten WITH CHECK to validate the tenant is active and orders are enabled:
```sql
WITH CHECK (EXISTS (SELECT 1 FROM tenants t JOIN tenant_settings ts ON ts.tenant_id=t.id
                    WHERE t.id = orders.tenant_id AND t.is_active = true AND ts.orders_enabled = true))
```
For ingredient/option public reads, add a join to products to filter out unavailable products. Or accept the leak and move on; it's lower priority than the orders insert tightening.

### P2-02 — `auth/register` profile upsert omits role; relies on column default `'store-admin'`
**File:** `src/app/api/auth/register/route.ts:100-105`
**Evidence:** When a regular (email+password) user signs up, the post-signup upsert is `{ id, full_name, phone }` — no `role`. The `handle_new_user` trigger also creates a profile without specifying role, so column default `'store-admin'` wins. **Every email-signup user becomes a tenant-less store-admin.**
**Impact:** Every public sign-up creates a store-admin orphan. `/auth/resolve-redirect` then routes them to `/onboarding` (line 64), which is *probably* what's intended — but a tenant-less store-admin role bypasses customer-only checks (`if (role === 'customer') return 403`) until they finish onboarding. Subtle privilege ambiguity.
**Fix:** Be explicit. Set `role: 'store-admin'` at sign-up if that's the intent (and change the column default to `null`), or make the column default `'customer'` and gate `/onboarding` to upgrade them. Don't rely on a default value to encode business logic.

### P2-03 — `OrdersClient` realtime ignores its own optimistic INSERT, but races with the polling refetch
**File:** `src/app/(admin)/orders/OrdersClient.tsx:240-247, 257-266`
**Evidence:** Realtime INSERT handler dedupes via `prev.some(o => o.id === fullOrder.id)`. Polling at line 257 replaces the entire state with the fetch response. If a status update lands in DB just after polling reads, then realtime fires INSERT for a brand new order, the optimistic update in `updateStatus()` at line 299 (`o.id === orderId ? { ...o, status: data.status } : o`) is preserved only until the next 15s poll, which may overwrite it.
**Impact:** Status reverts visible to kitchen staff during the 15s window. Frustrating UX, not a data bug.
**Fix:** Use the realtime channel as the only source of truth (drop the 15s poll) once a proper UPDATE listener is added (P0-06). Or merge poll results into existing state by id rather than replacing.

### P2-04 — Realtime channel name includes tenantId but no profile filter on the auth side
**File:** `src/app/(admin)/orders/OrdersClient.tsx:223`
**Evidence:** `supabase.channel(`orders-realtime-${tenantId}`)`. The `supabase` is the **anon-key browser client**. Real-time RLS pushes to a connection get filtered by the current session's auth — for staff in tenant A, the JWT has profile→tenant_id=A, so RLS evaluates `tenant_id = auth_tenant_id()` correctly. Fine in single-tenant. But: the filter `tenant_id=eq.${tenantId}` is client-supplied and trusted only because RLS catches anything broader. Defense in depth — RLS is correct. Mild smell only.

### P2-05 — `(admin)/orders/page.tsx` non-null-asserts `getEffectiveTenant()`
**File:** `src/app/(admin)/orders/page.tsx:8`
**Evidence:** `const { tenantId } = (await getEffectiveTenant())!`. If the middleware regression in P0-01 is fixed, an unauthenticated user could theoretically reach this code path via a stale cache; non-null assert masks the TS check. Pattern repeats in admin layout and `dashboard/page.tsx`.
**Fix:** Same as P1-02 — guard explicitly and redirect.

### P2-06 — Storage buckets are public with no `file_size_limit` or `allowed_mime_types`
**Evidence:** Live DB query on `storage.buckets`:
```json
[{"id":"tenant-assets","public":true,"file_size_limit":null,"allowed_mime_types":null},
 {"id":"product-images","public":true,"file_size_limit":null,"allowed_mime_types":null}]
```
The upload route validates and converts to WebP server-side (`src/lib/upload.ts` via `validateAndConvertToWebP`), but the storage policies (`auth upload tenant-assets`, `auth upload product-images`) have `WITH CHECK = null` — anyone authenticated can upload anything to either bucket, including JPEG malware, executable scripts, etc.
**Impact:** Authenticated user (any tenant, even staff) can upload arbitrary files to either public bucket. The Sharp pipeline in the route protects the *intended* upload UI, but a direct API call to the Supabase storage REST endpoint bypasses it.
**Fix:** Set `file_size_limit = 5242880` (5MB), `allowed_mime_types = ARRAY['image/webp','image/png','image/jpeg']`. Also tighten upload policies to require the path starts with the current user's tenant_id (so a staff member can only write to their tenant's prefix).

### P2-07 — Confirmation page "Try Again" links to `/checkout/:id`, but status is now `payment_failed`, which redirects them away
**File:** `src/app/(public)/checkout/[orderId]/confirmation/page.tsx:91`
**Evidence:** On `redirect_status === 'failed'` the page renders a "Try Again" button to `/checkout/${orderId}`. The checkout page (`page.tsx:49`) rejects any status other than `pending` with "Payment for this order failed. Please try again." and a "View Order" link back to the confirmation page. Loop.
**Impact:** Customer can never retry a failed payment via the UI — they're forced to create a new order from the menu. Lost conversions.
**Fix:** Either (a) allow `payment_failed` to enter the checkout flow (treat it like pending for retries), or (b) the webhook handler should reset status to `pending` and clear `payment_intent_id` on failure so a retry creates a fresh intent.

### P2-08 — `superadmin/users` PATCH includes `'customer'` in allowedRoles → 500 on use (see P0-02)
Already covered in P0-02. Lower-severity sibling: even if the constraint is fixed to allow `'customer'`, the PATCH semantics are off — it clears `tenant_id` for `customer` and `superadmin` (correct), but for any role with empty body it falls through and clears tenant_id too (`!rawRole` branch).

### P2-09 — `(public)/[slug]/page.tsx` Open Graph image absolute URL
Lower priority of P1-07. Same root.

---

## P3 — Low (polish, consistency, minor cleanups)

### P3-01 — `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in .env.example with no validator
**Evidence:** `.env.example` lists `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…` but no startup-time check that it's set (or at least matches the `STRIPE_SECRET_KEY` mode — both test or both live). Could pair `pk_live` with `sk_test` in production by mistake.
**Fix:** Add an env validation step (zod or `process.env` runtime check) at server start.

### P3-02 — `auth_tenant_id()` SQL function has no fallback for null
**Evidence:** `SELECT tenant_id FROM public.profiles WHERE id = auth.uid()` — returns NULL if user has no profile or no tenant. Most RLS policies tolerate this (`tenant_id = auth_tenant_id()` becomes `tenant_id = NULL` → false, correctly blocked). But comparing `NULL = NULL` is unknown not false, so a row with `tenant_id IS NULL` wouldn't match either. The 4 orphan profiles in the DB are tenant_id=NULL. Edge case but worth a `COALESCE`.
**Fix:** Wrap policies that allow tenant-scoped writes with `auth_tenant_id() IS NOT NULL AND tenant_id = auth_tenant_id()`.

### P3-03 — `next.config.ts` still allows `images.unsplash.com` for marketing seed images
Already P3-05 in round 1, not fixed.

---

## Confirmations (Round 1 fixes that still hold)

I re-verified the audit-DONE items still apply:

- **P0-01/02 (Stripe webhook columns + service client):** `processed_stripe_events` has `event_id` + `event_type` columns (confirmed via DB). Webhook uses `createServiceClient()` (confirmed in code).
- **P0-03 (orders payment columns):** `payment_intent_id` exists, `orders_status_check` includes `paid` and `payment_failed`, code reads `total` and converts (mostly — P0-03 finds the one missed place).
- **P0-04 (stripe_connections columns):** `disconnected_at`, `created_at`, `updated_at` all exist + trigger on UPDATE.
- **P0-05 (cancel_at_period_end):** exists on `tenant_subscriptions`.
- **P0-06 / P0-07 / P0-08 / P0-10 / P0-11 (auth gaps):** all routes now call `getEffectiveTenant()` / `assertSuperadmin()` as claimed.
- **P0-09 (force_verified removed):** PATCH `/api/admin/tenants/[id]` no longer accepts the body short-circuit.
- **P1-01 (HMAC OAuth state):** new `src/lib/stripe-oauth-state.ts` is properly using HMAC-SHA256 + timestamp expiry.
- **P1-08 / P1-09 (role normalization):** `normalizeRole` is used in `assertSuperadmin` and `getEffectiveTenant`.
- **P1-05 (staff password):** No more `Staff@12345` fallback (but new finding P1-01 about Math.random).
- **P1-07 (signout POST):** confirmed converted.

**Clean DB integrity:** No orphan order_items / order tenant mismatches / option-group cross-tenant rows / products with missing tenant references / categories with cross-menu tenant mismatch / duplicate default menus / invalid tenant slug characters. RLS is enabled on every public table (except `platform_settings` — see P1-06).

---

## Recommendations

### Fix tonight (P0 cluster — the app is currently broken on `main`)

1. **P0-01 (middleware regression) — REVERT immediately.** This is the blast-radius leader. Until you fix this, the app responds 404 to every meaningful URL. One-line revert: shrink `BLOCKED_TENANT_SLUGS` back to the marketing-only set from commit `f12c54b`. No DB migration needed.
2. **P0-02 (customer role constraint).** Add `'customer'` to `profiles_role_check` and backfill the 4 orphan profiles. Without this fix, customer registration and staff deletion both silently fail.
3. **P0-03 (total_cents in confirmation page) + P0-04 (broken /menu/${slug} links).** Two simple string edits.
4. **P0-05 (paid status not in VALID_STATUSES) + P0-06 (no UPDATE realtime listener).** KDS doesn't work end-to-end without these. Add `paid`/`payment_failed` to the API whitelist, to `NEXT_STATUS`, `STATUS_COLORS`, `ADVANCE_LABEL`, and add `event: 'UPDATE'` subscription.
5. **P0-07 (Stripe disconnect uses cookie client).** One-line change to `createServiceClient()`.
6. **P0-08 (ISR caches scan events).** Move the scan_events insert out of the ISR'd page into a small client-side fetch.

### High-leverage P1s for the same PR

7. **P1-01 (Math.random for passwords).** Two-line change — swap for `crypto.randomInt`.
8. **P1-03 (legacy `tenants.plan` column vs `tenant_subscriptions`).** Decide source of truth. If `tenant_subscriptions` wins (recommended), seed onboarding with a default row.
9. **P1-08 (TS types out of sync with DB).** Add a CI step that runs `supabase gen types typescript` and fails the build on diff. This would have caught half the round-1 P0s AND P1-08 today.

### Defer / strategic

10. **P1-04 / P1-05 (FK on-delete behavior on plans/scan_events).** Worth a follow-up migration that audits *all* FK on-delete behaviors and standardizes to CASCADE where the parent owns the child.
11. **P2-06 (storage bucket limits).** Set MIME-type and size limits on both buckets. Tighten upload policies to require tenant-prefixed paths.
12. **P3-01 (env validator).** Add a zod-based env schema parsed at server boot; fail fast on misconfigured production deploys.

### The bigger picture

Two structural fixes would have prevented every round-1 P0 and most of round-2:

1. **DB types codegen in CI.** `supabase gen types typescript --linked > src/types/database.ts` plus `git diff --exit-code` on the file. Catches schema drift the moment it lands.
2. **Integration tests for API routes.** A vitest suite that calls each route against a local Supabase fixture would catch every "missing auth guard", "missing column", and "status whitelist out of date" bug in this report. Hand-rolled curl scripts work too.

The third structural fix is process: **Wave 4 of round-1 remediation introduced P0-01 — the audit fix itself was the regression.** That happens when the auditor (round 1) and the implementer (the overnight Waves) optimize for different things. A short "verify each fix changed only what was intended" pass would have caught it. Even a `git diff` review by another pair of eyes on a hot-fix landing 5 commits in 90 minutes.
