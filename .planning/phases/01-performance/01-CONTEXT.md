# Phase 1: Performance — Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Source:** Session baseline analysis (bundle analysis + code audit)

<domain>
## Phase Boundary

This phase delivers concrete performance improvements to the **public menu page** (the highest-traffic route — every restaurant customer hits it via QR code scan). Scope is limited to changes that:
1. Reduce JS shipped to public visitors (no admin code leaking)
2. Enable caching of menu data (currently force-dynamic, re-queries Supabase on every scan)
3. Eliminate redundant DB queries (generateMetadata duplicates page queries)
4. Shrink the polyfill bundle via browserslist

**Out of scope for this phase:**
- Admin UI refactoring or client component reduction
- Supabase client removal from ProductsClient, BrandingClient (admin-only, acceptable)
- DB indices or RLS optimization (deferred to SEED-004 full milestone)
- Lighthouse audits / real-user metrics (need production deploy first)
- MenuPage.tsx decomposition (overlaps with SEED-002 cart work, deferred)

</domain>

<decisions>
## Implementation Decisions

### Caching strategy
- Remove `export const dynamic = 'force-dynamic'` from `src/app/(public)/[slug]/page.tsx` and `src/app/(public)/[slug]/[menuSlug]/page.tsx`
- Add `export const revalidate = 60` — menus change infrequently, 60-second CDN cache is acceptable
- `scan_events` INSERT is already fire-and-forget (`.then(() => {})`) — does not block render; keep as-is
- **Invalidation**: when admin updates menu/categories/products, call `revalidatePath('/{slug}')` and `revalidatePath('/{slug}/{menuSlug}')` — this is DEFERRED to Phase 2 of SEED-004 (not blocking for now; 60s natural expiry is acceptable for v1)

### Root page redirect
- Remove `export const dynamic = 'force-dynamic'` from `src/app/page.tsx`
- The page only calls `redirect('/auth/login')` — no data fetching, can be static

### Parallel data fetching (public menu)
- Current `src/app/(public)/[slug]/[menuSlug]/page.tsx` fetches tenant THEN menu sequentially (menu query uses `tenant.id`)
- Optimization: fetch tenant (by slug) and menu (by menuSlug) in parallel, then cross-validate `menuCandidate.tenant_id === tenant.id`
- This saves 1 DB round-trip latency per page load

### React cache() for metadata deduplication
- `generateMetadata` in both public page files queries tenant data that the page function also queries
- Wrap the tenant fetch in React's `cache()` so Next.js deduplicates the call within the same request
- Pattern:
  ```ts
  import { cache } from 'react'
  const getTenant = cache(async (slug: string) => {
    const supabase = await createServiceClient()
    return supabase.from('tenants').select('*, tenant_settings(*)').eq('slug', slug).eq('is_active', true).single()
  })
  ```
- Both `generateMetadata` and `default export` use `getTenant(slug)` — only one DB call executes

### browserslist
- Add `"browserslist": "> 0.5%, last 2 versions, not dead, not IE 11"` to `package.json`
- This tells Next.js/webpack to compile less polyfill code for modern browsers
- Expected: polyfills chunk shrinks from 109 KB (38 KB gz) to approximately 60–80 KB (20–28 KB gz)
- No code changes required — just the package.json field

### Claude's Discretion
- Exact `revalidate` value (60s chosen, can be tuned later based on real data)
- Whether to use Next.js `unstable_cache` vs React `cache()` — use React `cache()` (stable, per-request)
- Exact parallel-fetch implementation details (see action below)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Public routes to modify
- `src/app/page.tsx` — root redirect, remove force-dynamic
- `src/app/(public)/[slug]/page.tsx` — slug-only public menu, remove force-dynamic, add revalidate, add cache()
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — slug+menuSlug public menu, same as above + parallel fetch

### Supabase client (server-only — correct, do not change)
- `src/lib/supabase/server.ts` — `createServiceClient()` — server only, correct
- `src/lib/supabase/client.ts` — `createClient()` — browser client, used by admin components only

### Baseline data
- `.planning/phases/000-perf-baseline/REPORT.md` — full bundle analysis with concrete numbers
- `.next/analyze/client.html` — interactive bundle treemap (open in browser)

### Types
- `src/types/database.ts` — database types, needed for correct typing of cached functions

### Package config
- `package.json` — add `browserslist` field here
- `next.config.ts` — already has `withBundleAnalyzer` wrapper (added in baseline phase)

</canonical_refs>

<specifics>
## Specific Implementation Details

### Parallel fetch pattern for /[slug]/[menuSlug]/page.tsx

Current (sequential — 2 round trips before content):
```ts
const { data: tenant } = await supabase.from('tenants').select('*, tenant_settings(*)')
  .eq('slug', slug).eq('is_active', true).single()
if (!tenant) notFound()
const { data: menu } = await supabase.from('menus').select('*')
  .eq('tenant_id', tenant.id).eq('slug', menuSlug).eq('is_active', true).single()
```

Target (parallel — 1 round trip + cross-validation):
```ts
const [{ data: tenant }, { data: menuCandidate }] = await Promise.all([
  supabase.from('tenants').select('*, tenant_settings(*)').eq('slug', slug).eq('is_active', true).single(),
  supabase.from('menus').select('*').eq('slug', menuSlug).eq('is_active', true).single(),
])
if (!tenant || !menuCandidate || menuCandidate.tenant_id !== tenant.id) notFound()
const menu = menuCandidate
```

### React cache() deduplication pattern

```ts
import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'

const getTenantBySlug = cache(async (slug: string) => {
  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('*, tenant_settings(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()
  return data
})
```

This function is called once by `generateMetadata` and once by the page component — React deduplicates, only 1 DB query fires per request.

### Verification approach

After implementing, re-run:
```bash
# Quick build check
npm run build

# Full baseline comparison (slow — only if needed)
ANALYZE=true npx next build --webpack
```

Check: public routes should now show `○ (Static)` or include revalidate annotation instead of `ƒ (Dynamic force)` in build output.

</specifics>

<deferred>
## Deferred Ideas

- `revalidatePath()` on menu update — deferred to SEED-004 full milestone (Phase 2)
- MenuPage.tsx decomposition — deferred to SEED-002 (cart extraction needed first)
- DB indices for RLS helpers — deferred to SEED-004 full milestone
- Lighthouse CI budget — deferred to SEED-004 full milestone
- Supabase client removal from admin components — acceptable in admin, low priority
- Edge runtime for public routes — research needed, deferred

</deferred>

---

*Phase: 01-performance*
*Context gathered: 2026-05-05 from bundle baseline analysis + code audit*
