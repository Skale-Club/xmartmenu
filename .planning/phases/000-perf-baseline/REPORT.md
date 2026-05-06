# Performance Baseline Report

**Date:** 2026-05-05
**Phase:** 000 — pre-GSD baseline (foundation for [SEED-004](../../seeds/SEED-004-system-performance-optimization.md))
**Build:** Next.js 16.2.2 (production, webpack — Turbopack analyzer is broken/experimental on 16.2.2)

## TL;DR

| Metric | Value | Verdict |
|---|---|---|
| Total client JS shipped | **1322 KB raw / 346 KB gz** | High for a menu app |
| Top non-framework chunk | **216 KB / 59 KB gz** (`3794-...js`) | Suspicious — likely MenuPage |
| Supabase client in browser | **170 KB / 47 KB gz** | Shipping to every visitor |
| Public menu route bundle | not isolated — code lives in shared chunks | Bad: login/landing pay the cost too |
| Largest source file | **MenuPage.tsx 942 lines** (`'use client'`) | Confirmed bottleneck |
| Build time (webpack) | 45s | Reference only — Turbopack does it in 20s |

## Methodology

1. Installed `@next/bundle-analyzer` (devDep) and wired it into `next.config.ts`
   behind an `ANALYZE=true` env flag.
2. `@next/bundle-analyzer` does not support Turbopack (Next 16 default), so
   ran the build with `--webpack` once just for analyzer compatibility:
   `ANALYZE=true npx next build --webpack`
3. Generated reports in [`.next/analyze/`](../../../.next/analyze/):
   - `client.html` (391 KB) — what the browser downloads
   - `nodejs.html` (562 KB) — server-side bundles
   - `edge.html` (279 KB) — middleware bundle
4. Cross-referenced raw chunk sizes from `.next/static/chunks/` and grepped
   chunks for library signatures.

## Bundle Findings

### Top client chunks

| Chunk | Raw | Gzipped | Contents (heuristic) |
|---|---|---|---|
| `3794-...js` | 216 KB | 59 KB | **No library hits — likely app code (MenuPage + deps)** |
| `4bd1b696-...js` | 195 KB | 61 KB | React 19 + scheduler internals |
| `framework-...js` | 185 KB | 58 KB | React framework |
| `5536-...js` | 170 KB | **47 KB** | **`@supabase/ssr` + `@supabase/supabase-js`** ← shipped to every visitor |
| `main-...js` | 128 KB | 36 KB | Next runtime |
| `polyfills-...js` | 109 KB | 38 KB | Legacy browser polyfills |

### Per-route page bundles (lean — these are fine)

```
21 KB  /tenants (superadmin list)
16 KB  /menu/products (admin)
13 KB  /settings (superadmin)
12 KB  /menus (admin)
11 KB  /onboarding
10 KB  /tenants/[id]
 9 KB  /settings/branding
 6 KB  /auth/login
 5 KB  /auth/register
 0 KB  /  (just a redirect)
```

**The per-page chunks are not the problem — the shared chunks are.**

### What's missing from the per-route table

Public menu routes `/[slug]` and `/[slug]/[menuSlug]` **don't appear in the
per-route output**. This means [src/components/menu/MenuPage.tsx](../../../src/components/menu/MenuPage.tsx)
(942 lines, `'use client'`) is bundled into one of the shared chunks (most
likely `3794-...js`, the 216 KB anonymous one). Consequence: even users hitting
`/auth/login` download MenuPage code they will never run.

## Source Code Findings (file-size proxy)

### Largest client components (`'use client'`)

```
942  src/components/menu/MenuPage.tsx                            ★ public, hot path
691  src/app/(superadmin)/tenants/TenantsClient.tsx
576  src/app/(admin)/menu/products/ProductsClient.tsx
446  src/app/onboarding/page.tsx
383  src/app/(admin)/menus/MenusClient.tsx
313  src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx
265  src/app/(admin)/menu/categories/CategoriesClient.tsx
235  src/app/(admin)/settings/staff/StaffClient.tsx
234  src/app/(admin)/settings/branding/BrandingClient.tsx
228  src/app/(superadmin)/settings/SettingsClient.tsx
```

**20 client components total** — too many for a mostly-static menu product. Each
`'use client'` boundary forces React to ship the component + its descendants to
the browser.

### Largest API routes

```
261  src/app/api/onboarding/route.ts
110  src/app/api/orders/route.ts
108  src/app/api/auth/register/route.ts
 98  src/app/api/superadmin/tenants/route.ts
 92  src/app/api/admin/staff/route.ts                            ★ N+1 confirmed in audit
```

## Concrete Issues Identified

### #1 — Supabase client shipped to every browser (HIGH)

`@supabase/ssr` + `@supabase/supabase-js` = **170 KB raw / 47 KB gz** in chunk
`5536-...js`. Loaded on routes that have no client-side Supabase use (e.g.
`/auth/login`, `/`, public menu pages that already fetch server-side).

**Fix:** audit which client components actually call Supabase from the browser.
Most likely candidates use it for auth state or realtime. Move what can be
server-only out of `'use client'` files. For unavoidable client uses, lazy-import
via `next/dynamic` or dynamic `import()`.

### #2 — MenuPage.tsx is a 942-line client monolith (HIGH)

Single component handles search, filtering, cart, language switcher, modals,
order submission. It's also the public-facing hot path and its bundle leaks
into shared chunks (issue #4 below).

**Fix (overlap with [SEED-002](../../seeds/SEED-002-customer-order-system.md)):**
- Extract `CartContext` to its own file (also unblocks SEED-002 cart work)
- Lazy-load product detail modal via `next/dynamic({ ssr: false })`
- Split language switcher into separate component
- Move pure display sub-trees (category list, product card) to RSC where possible

### #3 — 20 client components, including admin views that don't need interactivity at the boundary (MEDIUM)

Admin pages like `BrandingClient.tsx` (234 lines) and `SettingsClient.tsx`
(228 lines) are entirely `'use client'`. Many sections inside are likely static
display.

**Fix:** RSC-by-default audit. Wrap only the truly interactive widgets in
client components; let everything else render server-side.

### #4 — Public routes inherit code from admin routes via shared chunking (HIGH)

Webpack's automatic chunking groups frequently-co-imported modules. Because
MenuPage and admin clients share dependencies (Supabase client, lucide icons,
maybe utility modules), all of it lands in the same shared chunks. Result: a
visitor hitting `/auth/login` downloads enough JS to run the entire admin UI.

**Fix:** explicit `splitChunks` config to isolate public-route deps, OR move
public menu to a separate route group with restricted imports, OR adopt Edge
runtime for public routes (forces a leaner bundle).

### #5 — Polyfills are 109 KB / 38 KB gz (LOW)

Default Next polyfills target very old browsers. If supporting only
evergreen browsers (last 2 versions), this can shrink significantly.

**Fix:** add a `browserslist` field to `package.json` targeting modern browsers.

### #6 — Build time 45s with webpack vs 20s with Turbopack (INFO)

Turbopack is 2.25× faster. Already the default for `dev` and `build`. Only use
`--webpack` for the analyzer until `next experimental-analyze` stabilizes.

## What Was NOT Measured (Next Phase)

This baseline is **bundle-only**. The full SEED-004 measurement phase needs:

1. **DB query plans** — `EXPLAIN ANALYZE` on:
   - public menu fetch (most-hit query, in `src/app/(public)/[slug]/page.tsx`)
   - orders insert (RLS overhead — also touches the HIGH bug from CONCERNS.md
     about anonymous INSERT)
   - staff list (N+1 confirmed in `src/app/api/admin/staff/route.ts:22-37`)
2. **Real-user metrics** — Vercel Speed Insights or `web-vitals` reporter for
   p50/p75/p99 LCP, FID, CLS, TTFB per route.
3. **Lighthouse audits** — desktop + mobile scores for `/`, `/auth/login`,
   `/{tenantSlug}`. Set 95+ targets.
4. **Cold-start measurement** — first request after idle, especially on Vercel
   serverless + Supabase cold connection.
5. **Middleware overhead** — measure latency added by Supabase session refresh
   on every request (`src/lib/supabase/middleware.ts`). Decide which routes can
   skip it (matcher config).
6. **Image delivery audit** — does `MenuPage` use `next/image` with proper
   `sizes`? Are uploaded images served at responsive widths?

## Recommended Next Phases (in order)

| # | Phase | Effort | Win |
|---|---|---|---|
| 1 | Add Vercel Speed Insights + production deploy | S | Real-user data starts flowing |
| 2 | Identify chunk 3794 contents via analyzer HTML | S | Confirms MenuPage hypothesis |
| 3 | Extract CartContext from MenuPage (also unblocks SEED-002) | M | Reduces public-route bundle, enables lazy loading |
| 4 | Audit `'use client'` boundaries — convert pure display to RSC | M | Reduces JS shipped across app |
| 5 | Add missing DB indices (CONCERNS.md §Performance Bottlenecks) | S | Faster RLS checks, lower DB load |
| 6 | Move public menu to Edge runtime + add `revalidate` | M | TTFB improvement + cache hits |
| 7 | Set `browserslist` to drop legacy polyfills | XS | -38 KB gz to every visitor |
| 8 | Performance budget in CI (bundle-size, Lighthouse) | M | Prevents regression |

## Files Modified by This Baseline

- [next.config.ts](../../../next.config.ts) — wrapped with `withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })`
- [package.json](../../../package.json) — added `@next/bundle-analyzer` to devDependencies

## How to Re-Run

```bash
# Bundle analyzer (use webpack until Turbopack analyzer stabilizes)
ANALYZE=true npx next build --webpack
# Reports written to .next/analyze/{client,nodejs,edge}.html
# Open client.html in a browser for the interactive treemap

# Normal builds remain on Turbopack — analyzer flag is opt-in
npm run build
```

---

*Baseline collected: 2026-05-05. Next instrumentation step: ship to Vercel and enable Speed Insights to start collecting real-user data.*
