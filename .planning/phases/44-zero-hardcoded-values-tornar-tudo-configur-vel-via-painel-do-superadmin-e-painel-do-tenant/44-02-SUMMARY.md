---
phase: 44-zero-hardcoded-values
plan: 02
subsystem: ui
tags: [landing-page, platform-settings, next.js, react, typescript, marketing]

# Dependency graph
requires:
  - phase: 44-01
    provides: platform_settings landing JSONB structure and superadmin editor wiring

provides:
  - All landing page sections (HowItWorks, FeatureBlocks, FooterCTABand, Footer, Nav) read from platform_settings.landing JSONB via platformLanding prop
  - page.tsx fetches both landing and app_name columns and passes both to ClientLandingPage
  - app_name used in JSON-LD structured data blocks with XmartMenu fallback
  - Hardcoded fallbacks in every section component so landing never breaks on empty DB

affects: [marketing-landing-page, superadmin-settings, seo-metadata]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Prop-drilling with hardcoded fallbacks: DB data ?? hardcoded constant — zero runtime errors on empty DB
    - Icon index mapping: map DB steps by array index to Lucide icon array, fallback to last icon
    - copyright template: data?.copyright ? `© ${data.copyright}` : hardcoded default

key-files:
  created: []
  modified:
    - src/app/(marketing)/page.tsx
    - src/app/(marketing)/ClientPage.tsx

key-decisions:
  - "FAQ section intentionally stays hardcoded — no faq array in platform_settings.landing JSONB schema; comment documents scope boundary"
  - "Icon resolution for DB-driven steps uses array index mapping to [UserPlus, UtensilsCrossed, QrCode] — DB step icon string not rendered (avoids dynamic icon lookup complexity)"
  - "app_name fetched in same query as landing (single DB round trip) and passed as separate appName prop alongside platformLanding"

patterns-established:
  - "DB-driven landing sections: accept data prop typed to DB shape, derive resolved* local variable from data?.field ?? hardcodedFallback, render resolved*"

requirements-completed: [CFG-02, CFG-03]

# Metrics
duration: 3min
completed: 2026-05-20
---

# Phase 44 Plan 02: Zero Hardcoded Values — Landing Sections Summary

**platform_settings.landing JSONB now drives HowItWorks, FeatureBlocks, FooterCTABand, Footer, and Nav — superadmin edits are live on the landing page with hardcoded fallbacks for empty DB**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-20T03:52:58Z
- **Completed:** 2026-05-20T03:55:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Expanded `getPlatformSettings()` query to fetch `landing, app_name` in one round trip
- Destructured `appName` separately and passed it to `ClientLandingPage` alongside `platformLanding`
- `app_name` used in JSON-LD Organization and SoftwareApplication structured data blocks
- Added `HowItWorksData`, `FeaturesData`, `CtaData`, `FooterData` TypeScript interfaces
- All five section components (`Nav`, `HowItWorks`, `FeatureBlocks`, `FooterCTABand`, `Footer`) accept typed data/appName props and fall back to hardcoded constants when DB data is null
- `FAQ` stays intentionally hardcoded with a code comment explaining the scope boundary

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand page.tsx query to include app_name** - `9be6c0e` (feat)
2. **Task 2: Wire all landing sections in ClientPage.tsx to platformLanding prop** - `c49e47f` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/app/(marketing)/page.tsx` - Now selects `landing, app_name`; passes `appName` to ClientLandingPage and uses it in JSON-LD
- `src/app/(marketing)/ClientPage.tsx` - All section components accept data/appName props with hardcoded fallbacks; FAQ has intentionally-hardcoded comment

## Decisions Made
- FAQ stays hardcoded (no DB equivalent in platform_settings.landing) — documented with comment
- Icon array index mapping for DB-driven steps — avoids dynamic icon lookup from string names
- Single DB query for both `landing` and `app_name` columns (no extra round trip)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All landing sections now configurable via the superadmin settings panel (Plan 44-01)
- Plan 44-03 can proceed — tenant-facing configurable values

---
*Phase: 44-zero-hardcoded-values*
*Completed: 2026-05-20*
