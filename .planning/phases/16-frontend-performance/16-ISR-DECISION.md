# Phase 16 — ISR and Cache Decision Record
**Date:** 2026-05-07
**Requirement:** FE-04
**Bundle analyzer run:** 2026-05-07
**Command:** `ANALYZE=true npx next build --webpack`
**Reports generated:** `.next/analyze/client.html`, `.next/analyze/edge.html`, `.next/analyze/nodejs.html`

---

## Route Audit

| Route | ISR Value | Decision | Justification |
|-------|-----------|----------|---------------|
| `/` (landing, via `(marketing)/page.tsx`) | `force-static` | No change | CDN edge, no dynamic data, correct. Confirmed present. |
| `/{slug}` | `revalidate = 60` | No change | Menu data changes ~0-10x/day; 60s propagation is acceptable; shorter increases DB load without benefit |
| `/{slug}/{menuSlug}` | `revalidate = 60` | No change | Same justification as `/{slug}` |

### Landing Page Confirmation

File `src/app/(marketing)/page.tsx` starts with:
```
export const dynamic = 'force-static'
```
Confirmed present. The `src/app/page.tsx` re-exports from `(marketing)/page.tsx` — both are force-static.

## ISR Recommendation

Retain current ISR values. The 60-second revalidation window is appropriate:
- **Fast enough for tenant urgency:** Sold-out items and price changes propagate within 1 minute
- **Slow enough to reduce Supabase read load:** One DB fetch per 60 seconds per route per region (not per visitor)
- **Menu data access patterns:** Tenants typically edit their menu 0-10 times per day, not multiple times per minute

If real traffic shows menu-change latency complaints, reduce to `revalidate = 30`. If Supabase DB costs spike, increase to `revalidate = 120`.

---

## Bundle Chunk 5536 — Investigation Results

### Overview

The original Phase 14 baseline identified chunk `5536-037bccf2959a697c.js` at 170.1 KB as an unnamed shared vendor chunk, hypothesized to contain Supabase JS or AI SDK fragments.

### Current Build Results (2026-05-07)

Webpack chunk hashes are non-deterministic across builds. The Phase 14 chunk `5536` corresponds to `5346-d8205c6a7a011cc2.js` (174.1 KB) in the current build. The size is unchanged (+4 KB from 170.1 KB — within measurement noise).

**Top chunks (current build):**

| Chunk | Size | Type | Contents |
|-------|------|------|----------|
| `1858-e53d2c4c13d6ecc4.js` | 221.4 KB | vendor | App Router runtime (react-dom, navigation internals) |
| `0937d497-ef90a2ed953c9e11.js` | 199.9 KB | vendor | Next.js shared runtime |
| `framework-0f99687943d41d6b.js` | 189.7 KB | vendor | React + scheduler (framework bundle) |
| `5346-d8205c6a7a011cc2.js` | 174.1 KB | **shared** | **@supabase/ssr, @supabase/gotrue-js, @supabase/auth-js — confirmed** |
| `main-e5f165fed0c76f47.js` | 131.4 KB | vendor | Next.js main entry (hydration bootstrap) |

### Root Cause Identified

The Supabase browser client (`@supabase/ssr` `createBrowserClient`) is imported in `src/components/admin/AdminSidebar.tsx` (`'use client'`). This is correct for admin functionality — the sidebar uses `supabase.auth.signOut()` for logout.

**The problem:** Next.js webpack bundling groups this into a shared vendor chunk (`5346`) that appears in the client reference manifest for the public `/(public)/[slug]/page` route. Confirmed via `.next/server/app/(public)/[slug]/page_client-reference-manifest.js` — chunk `5346` is listed in the `chunks` array for public menu pages.

```
Chunks referenced in public slug manifest:
  static/chunks/5346-d8205c6a7a011cc2.js  ← Supabase client bundle
  static/chunks/1071-f5a30c10d2bfdc11.js
  static/chunks/2554-d16e98dc290920cb.js
  static/chunks/519e8b78-c239579684113a1e.js
  ...
```

### Why This Is Difficult to Fix

The Supabase browser client is in the admin sidebar which is in the admin layout (`(admin)/layout.tsx`). The public menu pages (`(public)/[slug]/page.tsx`) are in a different route group. However, Next.js webpack creates **shared chunks** across route boundaries when modules are used in multiple routes. Because `AdminSidebar` is the only place `@supabase/ssr` `createBrowserClient` is used client-side, and it's only in admin routes, the current sharing behavior is a webpack optimization artifact.

### Fix Assessment

**Option A — Architectural split (deferred to Phase 17):**
Wrap AdminSidebar's Supabase dependency in a `next/dynamic` import with `ssr: false` OR split admin/public into separate module boundaries using Next.js `experimental.optimizePackageImports`. This requires 3+ file changes and carries risk of breaking the admin logout flow.

**Option B — Accept current state (chosen for Phase 16):**
The 174 KB chunk is the Supabase **browser client** (not the server client). It is correctly used in admin routes for session management. The cross-route chunk sharing is a webpack behavior. The public menu page (`MenuPage.tsx`) receives all data via server-side props — it does NOT call any Supabase APIs client-side. The bundle, while included in the manifest, may be lazy-loaded only when admin components are actually mounted (not on public menu pages).

### Decision for Phase 16

**Defer chunk 5346 elimination to Phase 17.**

Justification:
1. No clear one-file fix — fix requires structural changes to admin vs. public module boundaries
2. Risk of breaking admin logout functionality
3. The Supabase code in this chunk is the **browser client** (correct usage for admin UI), not a server-client leak
4. Public menu page (`MenuPage.tsx`) does NOT use Supabase client-side — all data comes as server-rendered props
5. Phase 16's primary optimization lever is image delivery (889 KB savings potential, not 174 KB)

**Phase 17 action item:** Investigate `next/dynamic` lazy-loading of `AdminSidebar` or webpack `splitChunks` configuration to prevent admin-only modules from appearing in public page manifests.

---

## FE-04 Status

**SATISFIED** — All public menu routes reviewed and documented.

- `force-static` confirmed on `/` (landing page)
- `revalidate = 60` confirmed and justified on `/{slug}` and `/{slug}/{menuSlug}`
- No ISR value changes required — current values are appropriate for the use case
- Bundle chunk 5536/5346 (174 KB, Supabase browser client) investigated, root cause identified, fix deferred to Phase 17 with documented justification
