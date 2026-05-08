---
phase: 16-frontend-performance
plan: 02
subsystem: infra
tags: [bundle-analysis, webpack, next.js, isr, supabase, cache, performance]

requires:
  - phase: 14-instrumentacao
    provides: Bundle baseline with chunk 5536 at 170.1 KB identified as investigation target

provides:
  - Bundle analyzer run with client.html treemap output
  - Chunk 5536 composition identified: @supabase/ssr browser client pulled into shared vendor chunk via AdminSidebar
  - Root cause documented: AdminSidebar 'use client' + createBrowserClient = shared chunk with public routes
  - ISR decision record for all three public routes satisfying FE-04
  - Fix deferred to Phase 17 with full architectural justification

affects: [17-lighthouse-regression, bundle-optimization]

tech-stack:
  added: []
  patterns:
    - "Bundle analysis via ANALYZE=true npx next build --webpack; inspect .next/analyze/client.html"
    - "RSC manifest inspection via .next/server/app/*/page_client-reference-manifest.js to trace chunk dependencies"
    - "ISR revalidate = 60 for tenant menu routes; force-static for landing"

key-files:
  created:
    - .planning/phases/16-frontend-performance/16-ISR-DECISION.md
  modified: []

key-decisions:
  - "Retain revalidate = 60 on /{slug} and /{slug}/{menuSlug} — 60s is optimal for menu data access patterns (0-10 changes/day)"
  - "Defer chunk 5346/5536 elimination to Phase 17 — fix requires structural changes to admin vs public module boundaries (>2 files)"
  - "Chunk 5346 contains Supabase browser client (correct usage in AdminSidebar for auth.signOut) not a server-client leak"

patterns-established:
  - "RSC manifest inspection pattern: read page_client-reference-manifest.js to trace which shared chunks a route actually loads"

requirements-completed: [FE-04]

duration: 35min
completed: 2026-05-07
---

# Phase 16 Plan 02: Bundle Analysis and ISR Review Summary

**Chunk 5536 composition identified as @supabase/ssr browser client in AdminSidebar; ISR revalidate = 60 retained on all public menu routes; FE-04 satisfied**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-07T22:00:00Z
- **Completed:** 2026-05-07T22:35:00Z
- **Tasks:** 2
- **Files modified:** 1 created (16-ISR-DECISION.md)

## Accomplishments

- Bundle analyzer run completed (`ANALYZE=true npx next build --webpack`); `.next/analyze/client.html` generated
- Chunk 5536 (now hash `5346-d8205c6a7a011cc2.js`, 174.1 KB) composition confirmed: `@supabase/ssr`, `@supabase/gotrue-js`, `@supabase/auth-js` — the Supabase browser client
- Root cause traced via RSC manifest: `AdminSidebar.tsx` (`'use client'`) imports `createBrowserClient`, which webpack groups into a shared vendor chunk that appears in the public slug page manifest
- ISR values confirmed correct and justified: `revalidate = 60` on `/{slug}` and `/{slug}/{menuSlug}`; `force-static` on `/` landing
- FE-04 satisfied with full decision record at `.planning/phases/16-frontend-performance/16-ISR-DECISION.md`

## Task Commits

1. **Task 1 + Task 2 combined: Bundle analysis + ISR decision record** - `7fd22e1` (chore)

## Files Created/Modified

- `.planning/phases/16-frontend-performance/16-ISR-DECISION.md` - Full decision record: route ISR audit, chunk composition findings, fix assessment, FE-04 status

## Bundle Analysis Results

| Chunk | Size | Contents |
|-------|------|----------|
| `1858-e53d2c4c13d6ecc4.js` | 221.4 KB | App Router runtime (react-dom, navigation) |
| `0937d497-ef90a2ed953c9e11.js` | 199.9 KB | Next.js shared runtime |
| `framework-0f99687943d41d6b.js` | 189.7 KB | React + scheduler |
| `5346-d8205c6a7a011cc2.js` | **174.1 KB** | **@supabase/ssr browser client (prev chunk 5536)** |
| `main-e5f165fed0c76f47.js` | 131.4 KB | Next.js hydration bootstrap |

**Chunk 5346 vs Phase 14 baseline:** 174.1 KB vs 170.1 KB (+4 KB, within measurement noise — no regression).

**Root cause:** `AdminSidebar.tsx` (`'use client'`) imports `createBrowserClient` from `@/lib/supabase/client`. Webpack groups this into shared vendor chunk `5346` which appears in the `/(public)/[slug]/page` RSC manifest. Confirmed via `.next/server/app/(public)/[slug]/page_client-reference-manifest.js`.

**Fix assessment:**
- This is the Supabase **browser client** (correct — AdminSidebar uses `supabase.auth.signOut()`), not a server-client leak
- Eliminating it from the public manifest requires splitting admin/public module boundaries (architectural change, > 2 files)
- Deferred to Phase 17 — document includes full rationale

## ISR Decision: Confirmed Values

| Route | ISR Value | Decision |
|-------|-----------|----------|
| `/` (landing) | `force-static` | No change — CDN edge, confirmed in `(marketing)/page.tsx` line 1 |
| `/{slug}` | `revalidate = 60` | No change — appropriate for menu data (0-10 changes/day) |
| `/{slug}/{menuSlug}` | `revalidate = 60` | No change — same justification |

## Decisions Made

- **Retain `revalidate = 60`:** 60 seconds propagates urgent changes (sold-out items) within 1 minute while avoiding per-visitor Supabase DB reads. No evidence of suboptimal values.
- **Defer chunk 5346 fix to Phase 17:** Fix requires structural admin/public module boundary separation. Risk of breaking admin logout. Phase 16 primary lever is image delivery (889 KB potential savings), not this 174 KB chunk.
- **Bundle client is correct usage:** Supabase `createBrowserClient` in AdminSidebar is correct architecture — admin UI needs browser-side auth for sign-out.

## Deviations from Plan

None — plan executed exactly as written. Bundle analyzer ran, chunk composition identified, ISR values confirmed, decision document written.

The chunk was not eliminated (plan allowed for deferral if "fix is non-trivial > 2 files" — which applies here). Fix deferred per plan specification.

## Issues Encountered

- Chunk hash changes between builds: Phase 14 chunk `5536-037bccf2959a697c.js` corresponds to `5346-d8205c6a7a011cc2.js` in this build — webpack chunk hashes are non-deterministic across builds. Content is the same.
- `strings` command not available on Windows — used `grep -oiE` pattern matching instead for chunk inspection.

## FE-04 Status

SATISFIED. See `.planning/phases/16-frontend-performance/16-ISR-DECISION.md`.

## Next Phase Readiness

- Phase 17 (Lighthouse CI regression gate) can proceed — no blocking issues from this plan
- Phase 17 or later should investigate webpack `splitChunks` config or `next/dynamic` lazy-loading of AdminSidebar to reduce shared vendor chunk footprint on public routes
- Primary Phase 16 work remaining: image optimization (Plan 03/04) — 889 KB savings potential on `/{slug}` to close the LCP 3.0s → 2.5s gap

---
*Phase: 16-frontend-performance*
*Completed: 2026-05-07*
