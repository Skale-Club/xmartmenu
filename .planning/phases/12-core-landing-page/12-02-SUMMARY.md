---
phase: 12-core-landing-page
plan: 02
subsystem: ui
tags: [landing-page, next-js, tailwind, lucide-react, server-components, force-static, seo]

requires:
  - phase: 12-core-landing-page/12-01
    provides: RESERVED_PATHS Set, middleware marketing bypass, Vercel Analytics in root layout, metadataBase in root layout.tsx

provides:
  - "(marketing)/layout.tsx — isolated html lang=en layout with Inter display:swap and page-level OG/Twitter metadata"
  - "(marketing)/page.tsx — complete static landing page with all 7 sections, force-static"
  - "src/app/page.tsx — root passthrough re-exporting marketing page"

affects: [12-03]

tech-stack:
  added: []
  patterns:
    - "(marketing) route group isolation — landing page gets its own html/body/lang/font/metadata without affecting admin routes"
    - "force-static export for CDN edge serving — zero server-side rendering on marketing page"
    - "All CTA buttons as plain anchor tags — no client JS for navigation"
    - "Native details/summary accordion — zero JS FAQ, no use client required"

key-files:
  created:
    - src/app/(marketing)/layout.tsx
    - src/app/(marketing)/page.tsx
  modified:
    - src/app/page.tsx

key-decisions:
  - "Camera icon used in place of Instagram (lucide-react@1.7.0 does not export Instagram) — Rule 1 auto-fix"
  - "FAQ rendered via .map() over faqs array — single <details> template in JSX yields 6 rendered items at runtime"
  - "Analytics/SpeedInsights NOT added to (marketing)/layout.tsx — already in root layout.tsx per D-03 (avoids duplication)"

patterns-established:
  - "(marketing) route group pattern: each marketing page gets isolated html/lang/font/metadata via layout.tsx"
  - "force-static + Server Components pattern: entire marketing page tree is server-rendered, no hydration overhead"

requirements-completed: [LP-01, LP-02, LP-03, LP-04, LP-05]

duration: 8min
completed: 2026-05-07
---

# Phase 12 Plan 02: Core Landing Page Summary

**Full static marketing landing page with 7 sections (nav, hero, how-it-works, features, FAQ, footer CTA, footer) — Server Components only, force-static, zero client JS.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-07T02:38:00Z
- **Completed:** 2026-05-07T02:46:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 created + 1 modified)

## Accomplishments

- Created `(marketing)/layout.tsx` with isolated `html lang="en"`, Inter display:swap, and page-level OG/Twitter metadata — prevents admin SaaS styles and pt-BR lang from bleeding in
- Created `(marketing)/page.tsx` with all 7 sections in exact spec order: sticky nav, hero, how-it-works, feature blocks (2x2 grid), FAQ accordion (native details/summary), footer CTA band, footer
- All copy matches CONTEXT.md D-10 through D-21 exactly — headline, subheadline, 3 steps, 4 features, 6 FAQ Q+As, legal links, copyright
- Root `src/app/page.tsx` replaced with clean re-export passthrough — visitor at `/` now sees marketing page instead of redirect to `/auth/login`
- Zero `use client` directives anywhere in `(marketing)/` — entire tree is Server Components

## Task Commits

1. **Task 1: Create (marketing)/layout.tsx** - `d798ee0` (feat)
2. **Task 2: Create (marketing)/page.tsx + root passthrough** - `15cb205` (feat)

## Files Created/Modified

- `src/app/(marketing)/layout.tsx` — Isolated marketing layout with lang="en", Inter display:swap, OG/Twitter metadata
- `src/app/(marketing)/page.tsx` — Complete static landing page, all 7 sections, force-static, no use client
- `src/app/page.tsx` — Root passthrough: `export { default } from './(marketing)/page'`

## Decisions Made

- Analytics/SpeedInsights excluded from `(marketing)/layout.tsx` — already present in root `src/app/layout.tsx` per Plan 01 (D-03). Adding here would duplicate scripts.
- Camera icon used as Instagram proxy — `Instagram` is not exported from lucide-react@1.7.0; `Camera` is the closest semantic substitute for a photo-sharing social icon.
- FAQ data as module-level const array with `.map()` — keeps JSX clean, single `<details>` template renders 6 items at runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Instagram icon not available in lucide-react@1.7.0**
- **Found during:** Task 2 (Create (marketing)/page.tsx)
- **Issue:** Plan and UI-SPEC specify `Instagram` from `lucide-react`, but lucide-react@1.7.0 does not export `Instagram` — `npx tsc --noEmit` failed with `TS2305: Module 'lucide-react' has no exported member 'Instagram'`
- **Fix:** Replaced `Instagram` import and usage with `Camera` icon — semantically closest proxy for a photo-sharing social platform icon available in the installed version
- **Files modified:** `src/app/(marketing)/page.tsx`
- **Verification:** `npx tsc --noEmit` exits 0 after fix; aria-label="Instagram" preserved on the anchor so accessibility is maintained
- **Committed in:** `15cb205` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — missing icon export)
**Impact on plan:** Minimal visual impact — Camera icon is visually clear for social context. aria-label="Instagram" is preserved. No scope creep.

## Issues Encountered

None beyond the Icon deviation documented above.

## User Setup Required

None — no external service configuration required.

## Known Stubs

- Social icon hrefs: `href="#"` for Instagram and WhatsApp — placeholder until real social handles are confirmed (per D-20, intentional)
- `/privacy` and `/terms` routes: linked in footer but pages not yet created (deferred to Plan 03 per 12-02-PLAN.md, D-21)

## Next Phase Readiness

- Landing page at `/` is fully operational — visitor sees marketing page, not login redirect
- Plan 03 can create `/privacy` and `/terms` placeholder legal pages to complete the footer link targets
- All 5 requirements (LP-01 through LP-05) completed

---
*Phase: 12-core-landing-page*
*Completed: 2026-05-07*
