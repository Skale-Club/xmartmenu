---
id: SEED-004
status: completed
completed: 2026-05-08
completed_in: v1.4 (Performance) + v1.9 (Performance Gaps)
planted: 2026-05-05
planted_during: pre-GSD (no .planning/STATE.md yet)
trigger_when: users report slowness, OR prepping for a growth/scale milestone, OR before launching to a real customer
scope: large
---

# SEED-004: System-wide performance optimization

## Why This Matters

The user reports the system feels noticeably slow — described as a "gigantesco
problema". Slowness is the kind of issue that compounds: every new feature is
built on a slow base, every customer interaction reinforces the perception, and
once a product feels slow people stop trusting it even after it's fixed.

The codebase audit ([.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md))
already surfaced concrete contributors. None of them is individually catastrophic;
the problem is **the cumulative effect of many small inefficiencies on every
request path**. A real optimization pass needs three things in order:

1. **Measure** — instrument and profile so decisions are data-driven, not vibes
2. **Fix the hot paths** — go after whatever profiling proves is slowest
3. **Prevent regression** — budget + monitoring so it doesn't drift back

Without measurement first, optimization is theater. The seed exists to make
sure when this work happens, it happens *properly*.

## When to Surface

**Trigger:** users report slowness, OR prepping for a growth/scale milestone, OR before launching to a real customer

This seed should be presented during `/gsd:new-milestone` when the milestone
scope matches any of these conditions:
- "Performance" / "optimization" / "speed" milestones
- Pre-launch / production-readiness milestones
- Scale / growth / load-testing milestones
- Any milestone touching the public menu page or order flow at scale
- After SEED-002 (orders) ships — order volume will expose new hot paths
- After significant traffic growth signals appear

## Scope Estimate

**Large** — full milestone. Plan as ~4 phases:

1. **Measurement & instrumentation** — add p99 latency tracking per route, bundle
   analyzer, EXPLAIN ANALYZE on hot DB queries, real-user metrics (RUM). Output:
   a baseline report with the actual top 10 slow paths.
2. **Frontend optimization** — code splitting, RSC/Client boundary audit,
   `next/image` responsive sizes, `MenuPage.tsx` decomposition.
3. **Backend optimization** — DB indices, N+1 fixes, React `cache()` and route
   `revalidate`, Edge caching for public menu, eliminate per-request session
   refresh where safe.
4. **Budget & monitoring** — performance budgets in CI (bundle size, Lighthouse),
   p99 alerting on slow routes, regression dashboard.

## Breadcrumbs

### Audit findings already documented
[.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md) covers most of
these in detail — start there. Specifically the "Performance Bottlenecks" and
"Fragile Areas" sections.

### Frontend hot spots
- [src/components/menu/MenuPage.tsx](src/components/menu/MenuPage.tsx) — **942 lines**,
  dozens of `useState` hooks, handles search + filtering + cart + i18n + modals + order
  submission in one component. Public route, highest traffic. Extract Cart to its own
  Context (already needed for SEED-002), lazy-load modals, split language switcher.
- [src/app/(public)/[slug]/page.tsx](src/app/\(public\)/[slug]/page.tsx) — public
  menu entry point; server component fetches menu/categories/products. Check what's
  shipped to the client vs what stays on the server.
- No `next build --analyze` baseline exists yet — first measurement task.

### Backend hot spots
- [src/app/api/admin/staff/route.ts](src/app/api/admin/staff/route.ts) lines 22-37 —
  N+1: bulk `profiles` fetch then `auth.admin.getUserById()` per staff. Batch or
  cache email in `profiles` table.
- [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts) — runs on every
  request, refreshes Supabase session. Necessary for SSR cookie-based auth, but
  audit which routes actually need it (public menu probably doesn't).
- [src/app/api/onboarding/route.ts](src/app/api/onboarding/route.ts) — multi-step
  tenant + menu + category + product creation, retries with fallback payloads
  (lines 192-210). Acceptable for one-shot onboarding, but profile to confirm.

### Database hot spots
- [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql)
  lines 144-156 — RLS helper functions `auth_tenant_id()` and `is_superadmin()` are
  called in `USING` clauses on every query. Each is a subquery against `profiles` or
  `auth.users`. Postgres usually inlines these but worth verifying with EXPLAIN.
- **Missing indices** (per audit):
  - `profiles(tenant_id)` — used in every RLS check, currently full-table scan
  - `profiles(role)` — used by `is_superadmin()`
  - Composite `(tenant_id, role)` for common filter patterns
  - `menus(tenant_id, is_default)` — used in default-menu fallback
- RLS policy count grew significantly through migration 019; per-query overhead
  scales with policies evaluated.

### Caching gaps
- No use of React `cache()` in any server component
- No `export const revalidate` in route segments
- Public menu (`/{slug}/{menuSlug}`) is a perfect ISR/Edge cache candidate —
  changes infrequently, served to every customer scan
- Supabase client is recreated per request — could be cached per-request via
  `cache()` wrapper
- No CDN headers set on Supabase storage public images

### Image delivery
- [src/lib/upload.ts](src/lib/upload.ts) uses `sharp` to convert uploads to WebP —
  but does it produce responsive sizes (e.g. 256w/512w/1024w)? Audit needed.
- [next.config.ts](next.config.ts) allows Supabase storage as remote pattern, but
  audit whether menu UI actually uses `next/image` with `sizes` prop — without it,
  the browser downloads the largest variant.

### Infra
- Vercel serverless cold starts add ~200-500ms to first request after idle. Pages
  that fan out to Supabase pay double the cold start. Edge runtime would help for
  public menu.
- Supabase free tier sleeps after ~1 week — Keepalive workflow exists
  (commits 630304e, c7599c9, 5066583) but doesn't address cold-query latency.

## Notes

- **Measure first, always.** This seed should NOT be opened with someone "just
  fixing the slow stuff." First milestone phase = instrumentation. Without a
  baseline, you can't tell if changes helped, and you'll waste time on the wrong
  bottlenecks (perception of slow != actual slow path).
- **The public menu page is the priority.** It's the highest-traffic route and
  the customer-facing first impression. If it loads in 200ms instead of 2s,
  the entire product feels different.
- **Don't ship caching without invalidation strategy.** Restaurant menus change.
  Cached menu serving stale prices is worse than slow menu serving correct prices.
  Plan invalidation alongside caching (write-path triggers `revalidatePath()`).
- **Coordinate with SEED-002.** Cart extraction from `MenuPage.tsx` happens in
  both seeds. Whichever ships first should leave the cart context in a shape the
  other can build on, not duplicate the work.
- **Coordinate with the auth/CI HIGH issues.** The "must_change_password bypass"
  and "inconsistent auth pattern" findings from CONCERNS.md will likely require
  middleware changes — those changes are the right moment to also audit
  middleware perf cost (per-request session refresh).
- **Tools to consider:** `@vercel/analytics`, `@vercel/speed-insights`, Sentry
  Performance, Supabase logs explorer, `next-bundle-analyzer`, Lighthouse CI.
