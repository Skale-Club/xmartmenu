---
phase: 01-performance
verified: 2026-05-05T00:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Measure actual TTFB on warm Vercel deployment"
    expected: "TTFB < 500ms for /{slug}/{menuSlug} on a cached (warm) response"
    why_human: "PERF-01 threshold requires a live deployment — cannot be tested statically or locally without the CDN cache layer"
  - test: "Confirm polyfill chunk is visibly smaller after browserslist change"
    expected: "polyfills chunk < 109 KB raw (baseline), ideally ~60-80 KB"
    why_human: "PERF-05 size reduction requires running ANALYZE=true npx next build --webpack and inspecting the bundle report — cannot be verified without running the build"
---

# Phase 1: Performance Verification Report

**Phase Goal:** The public menu page loads noticeably faster — JS bundle shrinks, DB queries are cached and parallelized, no admin code ships to public visitors.
**Verified:** 2026-05-05
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Root page (/) is statically generated — no server work on a pure redirect | VERIFIED | `src/app/page.tsx` has no `force-dynamic` export; contains only `import { redirect }` and `redirect('/auth/login')` |
| 2 | Public slug page uses ISR revalidate=60 — not force-dynamic | VERIFIED | Line 1 of `[slug]/page.tsx`: `export const revalidate = 60`; no `force-dynamic` present |
| 3 | Public slug+menuSlug page uses ISR revalidate=60 — not force-dynamic | VERIFIED | Line 1 of `[slug]/[menuSlug]/page.tsx`: `export const revalidate = 60`; no `force-dynamic` present |
| 4 | generateMetadata and page render share the same tenant DB call via React cache() — only 1 tenant query fires per request | VERIFIED | Both files define `getTenantBySlug = cache(...)` at module level; `generateMetadata` and page default export each call `getTenantBySlug(slug)` — React deduplicates to 1 DB call per request |
| 5 | Tenant and menu are fetched in parallel in [slug]/[menuSlug]/page.tsx — 1 round-trip instead of 2 | VERIFIED | Lines 41-44 of `[menuSlug]/page.tsx`: `Promise.all([getTenantBySlug(slug), supabase.from('menus')...])` in page function; also used in `generateMetadata` at line 28 |
| 6 | Public routes do not import the browser Supabase client | VERIFIED | `grep -r "supabase/client" src/app/(public)/` returns zero matches; both files import only from `@/lib/supabase/server` |
| 7 | package.json contains a browserslist field targeting modern browsers | VERIFIED | Line 5 of `package.json`: `"browserslist": "> 0.5%, last 2 versions, not dead, not IE 11"` |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/page.tsx` | Static root redirect — no force-dynamic | VERIFIED | 5 lines: import + blank + function + redirect + closing brace; no force-dynamic |
| `src/app/(public)/[slug]/page.tsx` | ISR with revalidate=60, React cache() dedup | VERIFIED | Exports `revalidate`, `generateMetadata`, `default`; `getTenantBySlug = cache(...)` at module level |
| `src/app/(public)/[slug]/[menuSlug]/page.tsx` | ISR, React cache(), parallel fetch | VERIFIED | Exports `revalidate`, `generateMetadata`, `default`; `getTenantBySlug = cache(...)`; 3 `Promise.all` calls |
| `package.json` | browserslist configuration | VERIFIED | Top-level field present, correct value, placed between `"private"` and `"scripts"` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `[slug]/page.tsx` | `getTenantBySlug` (React cache) | Both `generateMetadata` and `default` call `getTenantBySlug(slug)` | WIRED | Line 27 (generateMetadata) and line 45 (page function) both call it |
| `[slug]/[menuSlug]/page.tsx` | `Promise.all([tenant, menu])` | Parallel fetch in both `generateMetadata` and page function | WIRED | Lines 28 and 41 — two independent `Promise.all` calls, each fetching tenant + menu in parallel |
| `[slug]/[menuSlug]/page.tsx` | `getTenantBySlug` (React cache) | Both `generateMetadata` and `default` call `getTenantBySlug(slug)` | WIRED | Lines 29 and 42 |
| `[slug]/[menuSlug]/page.tsx` | Tenant isolation guard | `menuCandidate.tenant_id !== tenant.id` cross-validation before render | WIRED | Line 46: `if (!tenant \|\| !menuCandidate \|\| menuCandidate.tenant_id !== tenant.id) notFound()` |
| `package.json browserslist` | Next.js webpack polyfill generation | Next.js reads `browserslist` at build time | WIRED | Field present in package.json; build confirmed successful (documented in SUMMARY) |
| `src/app/(public)/` | `@/lib/supabase/server` only | No browser client imported | WIRED | Zero matches for `supabase/client` in public route directory |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `[slug]/page.tsx` — MenuPage | `tenant`, `categories`, `products` | Supabase queries: `tenants`, `menus`, `categories`, `products` | Yes — DB queries with `.eq()` filters and `.single()`/`.maybeSingle()` | FLOWING |
| `[slug]/[menuSlug]/page.tsx` — MenuPage | `tenant`, `menu`, `categories`, `products` | Supabase queries via `Promise.all`: `tenants`, `menus`, `categories`, `products` | Yes — DB queries with `.eq()` filters and `.single()` | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: The public routes are Next.js server components that require a live Supabase connection and a running Next.js server — they cannot be tested in isolation without the full runtime. Behavioral verification is routed to human verification for TTFB measurement (see Human Verification Required).

Git commits verified as actually existing in the repository:

| Commit | Description | Status |
|--------|-------------|--------|
| `8265ea1` | perf(01-01): remove force-dynamic from root page | VERIFIED in git log |
| `911be66` | perf(01-01): add ISR revalidate=60 and React cache() to /[slug] page | VERIFIED in git log |
| `3e0e554` | perf(01-01): add ISR revalidate=60, React cache(), and parallel fetch to /[slug]/[menuSlug] page | VERIFIED in git log |
| `d2cb134` | chore(01-02): add browserslist field to package.json | VERIFIED in git log |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PERF-01 | 01-01 | TTFB < 500ms on warm Vercel | NEEDS HUMAN | ISR (revalidate=60) is in place enabling cache hits; parallel fetch reduces round-trips; actual measurement requires live deployment |
| PERF-02 | 01-02 | Public bundle does not include browser Supabase client | SATISFIED | `grep -r "supabase/client" src/app/(public)/` returns zero matches; both files import only `createServiceClient` from `@/lib/supabase/server` |
| PERF-03 | 01-01 | Public pages use ISR/revalidate instead of force-dynamic | SATISFIED | Both `[slug]/page.tsx` and `[slug]/[menuSlug]/page.tsx` export `const revalidate = 60`; no `force-dynamic` in either file |
| PERF-04 | 01-01 | Root redirect (/) is statically generated | SATISFIED | `src/app/page.tsx` has no `force-dynamic`; only 5 lines; static by default |
| PERF-05 | 01-02 | Polyfill bundle reduced by targeting modern browsers | PARTIALLY HUMAN | `browserslist` field confirmed in `package.json` with correct value; actual bundle size reduction requires analyzer run |
| PERF-06 | 01-01 | generateMetadata and page render share tenant data (no duplicate DB queries) | SATISFIED | `getTenantBySlug = cache(...)` at module level in both public route files; 2 call sites per file share 1 cached DB call |
| PERF-07 | 01-01 | Tenant + menu queries run in parallel | SATISFIED | `Promise.all([getTenantBySlug(slug), supabase.from('menus')...])` in both `generateMetadata` and page function of `[slug]/[menuSlug]/page.tsx` |

No orphaned requirements detected. All 7 PERF IDs are claimed by plans 01-01 and 01-02 and accounted for above.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `[slug]/page.tsx` | 55, 67-68 | `let categories: any[] = []` / `let products: any[] = []` initialized as empty arrays | Info | Initial state only; populated by `Promise.all` inside `if (resolvedMenu?.id)` block — not a stub |
| `[slug]/page.tsx` | 24 | `(tenant.tenant_settings as any)?.logo_url` — `as any` cast | Info | Type cast for Supabase join result; does not affect correctness or caching behavior |

No blockers or warnings found. The empty-array initializations at lines 67-68 are legitimate conditional defaults (populated when `resolvedMenu?.id` exists) and are not stubs.

---

### Human Verification Required

#### 1. TTFB Measurement on Warm Vercel (PERF-01)

**Test:** Deploy to Vercel, scan a QR code or open `/{slug}/{menuSlug}` twice in sequence. Measure TTFB on the second request using DevTools Network tab or `curl -o /dev/null -s -w "%{time_starttransfer}\n"`.
**Expected:** TTFB < 500ms on the second (cached) request.
**Why human:** Requires a live Vercel deployment with CDN edge caching active. ISR is implemented in code but the threshold can only be validated against the actual infrastructure.

#### 2. Polyfill Bundle Size (PERF-05)

**Test:** Run `ANALYZE=true npx next build --webpack` and open `.next/analyze/client.html`. Find the `polyfills-...js` chunk.
**Expected:** Polyfills chunk < 109 KB raw (baseline). Target ~60-80 KB raw / 20-28 KB gz.
**Why human:** Bundle analyzer requires running the full Next.js build with webpack analyzer flag; cannot be checked statically.

---

### Gaps Summary

No gaps. All 7 requirements have implementation evidence in the codebase. Both artifacts that cannot be measured programmatically (TTFB, polyfill size) have their enabling code fully in place — the ISR revalidation, cache(), parallel fetch, and browserslist field are all verified present and wired. The human verification items are confirmatory measurements, not blockers.

---

_Verified: 2026-05-05_
_Verifier: Claude (gsd-verifier)_
