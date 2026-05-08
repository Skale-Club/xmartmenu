# Phase 14: Instrumentação — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Collect real production performance baselines before any optimization work begins. This phase produces data, not improvements. The output is a `14-BASELINE.md` file that Phases 15 and 16 will use to validate their optimizations against a known starting point.

Three deliverables:
1. Core Web Vitals by route from Vercel Speed Insights (PERF-01)
2. Supabase query timing for the three critical paths (PERF-02)
3. Bundle analysis report identifying largest chunks (FE-03)

</domain>

<decisions>
## Implementation Decisions

### Bundle Analysis
- **D-01:** `@next/bundle-analyzer` is ALREADY installed and configured in `next.config.ts` — `withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })` is live. No install needed.
- **D-02:** Run `ANALYZE=true npm run build` to generate report. Set `openAnalyzer: false` in config (already set) so it writes JSON/HTML without opening browser.
- **D-03:** Extract top 5 largest chunks from the generated report and document them with lazy-loading notes in `14-BASELINE.md`.

### Supabase Query Timing
- **D-04:** Two-layer approach — no new dependencies required:
  - **Layer 1 (DB-level):** Query `pg_stat_statements` via Supabase SQL editor for aggregate query timing across all critical paths. This gives mean/total execution time at the DB level.
  - **Layer 2 (Route-level):** Add `console.time()` / `console.timeEnd()` wrappers in the three critical server-side route handlers. Timing appears in Vercel function logs. Remove after baseline is captured (these are measurement probes, not permanent instrumentation).
- **D-05:** Critical paths to instrument:
  1. Public menu: `src/app/(public)/[slug]/page.tsx` and `src/app/(public)/[slug]/[menuSlug]/page.tsx`
  2. Orders: `src/app/api/orders/` INSERT route
  3. Tenant lookup / auth: `src/lib/supabase/middleware.ts` (updateSession)
- **D-06:** `console.time()` probes are TEMPORARY — added, measured, then REMOVED in the same plan. Do not leave timing probes in production code.

### Lighthouse Audit
- **D-07:** Priority order: public menu `/{slug}/{menuSlug}` first, then landing page `/`. Rationale: public menu is the page restaurant customers actually use; landing is `force-static` and expected to score well already.
- **D-08:** Use PageSpeed Insights (PSI) at `https://pagespeed.web.dev/` against production URL — no local CLI required, no extra install. Mobile score is the target metric (Lighthouse mobile, not desktop).
- **D-09:** Run audit after a production deploy of current main branch. Record both mobile and desktop scores. The mobile score is the binding metric for Phase 16 targets.

### Baseline Documentation
- **D-10:** Write a `14-BASELINE.md` file in `.planning/phases/14-instrumentacao/`. This is the single source of truth for pre-optimization scores.
- **D-11:** Baseline format (each section clearly labeled):
  - Lighthouse scores: route, mobile Performance, LCP, CLS, INP, desktop Performance
  - Bundle chunks: name, size (KB), lazy-load candidate (yes/no)
  - Supabase query timing: route, query description, mean execution time (ms)
- **D-12:** Phases 15 and 16 MUST read `14-BASELINE.md` before planning. It defines the "before" state.

### Vercel Speed Insights
- **D-13:** Speed Insights already installed (v1.3). No code changes needed. Access dashboard at `https://vercel.com/{team}/{project}/speed-insights` and export p75 LCP, CLS, INP per route.
- **D-14:** Document real-traffic data from Speed Insights if available (requires production traffic). If no data yet (app in early stage), note this and rely on PageSpeed Insights synthetic data instead.

### Claude's Discretion
- Exact `console.time()` placement within route handlers (function boundary vs query boundary)
- Which specific Supabase SQL queries to run against `pg_stat_statements`
- Format for Lighthouse screenshots (text values are sufficient, no screenshots needed)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/REQUIREMENTS.md` — PERF-01, PERF-02, FE-03 requirement definitions
- `.planning/PROJECT.md` — Stack and constraints (Supabase managed, Vercel, Next.js 16.2)

### Existing Code
- `next.config.ts` — Bundle analyzer config (already wired with ANALYZE env var)
- `src/app/(public)/[slug]/page.tsx` — Primary public route (tenant landing)
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — Menu page (priority for Lighthouse)
- `src/lib/supabase/middleware.ts` — Auth middleware (timing probe target)
- `src/app/api/orders/` — Orders API (timing probe target)
- `.github/workflows/ci.yml` — Existing CI (lint + build) — Phase 17 will extend this

### Baseline Output
- `.planning/phases/14-instrumentacao/14-BASELINE.md` — Created by this phase; referenced by Phases 15 and 16

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@next/bundle-analyzer` — already in devDependencies, configured in next.config.ts. Run with `ANALYZE=true npm run build`.
- `@vercel/speed-insights` — already imported in root layout. Dashboard data available at Vercel.
- `.github/workflows/ci.yml` — existing CI workflow. Phase 17 adds a Lighthouse CI job to this file.

### Established Patterns
- Supabase all analysis via SQL editor (no local Docker — established in v1.2 migrations)
- Server Components for public routes — query timing probes go in the server-side data fetch functions
- `force-static` on landing page `/` — no server timing probe possible there (static export)

### Integration Points
- Phase 15 (DB Indices) reads `14-BASELINE.md` to confirm which queries need index optimization
- Phase 16 (Frontend Performance) reads `14-BASELINE.md` to set Lighthouse score targets
- Phase 17 (CI Gate) uses Phase 16 achieved scores to set the regression threshold

</code_context>

<specifics>
## Specific Ideas

- User confirmed: "do what's ideal for the project" — decisions above reflect project constraints (free tier Supabase, Vercel deployment, no local Docker)
- Bundle analyzer already configured — this is mostly a run-and-document task, not a setup task
- `console.time()` probes are measurement instruments, not permanent code — add, measure, remove in same plan

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-instrumentacao*
*Context gathered: 2026-05-07*
