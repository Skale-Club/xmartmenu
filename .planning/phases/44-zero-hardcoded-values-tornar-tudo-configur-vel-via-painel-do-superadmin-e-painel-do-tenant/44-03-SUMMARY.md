---
phase: 44-zero-hardcoded-values
plan: 03
subsystem: ui
tags: [metadata, seo, next.js, platform_settings, isr, marketing, superadmin]

requires:
  - phase: 44-01
    provides: migration 045 adding seo_title/seo_description columns to platform_settings
  - phase: 44-02
    provides: landing page wiring of platform_settings values

provides:
  - generateMetadata() in (marketing)/layout.tsx reading seo_title, seo_description, app_name from DB
  - revalidate = 60 ISR on marketing layout
  - getPlatformSettings() cached helper (single DB call per request)
  - Superadmin sidebar brand link renders ps?.app_name ?? 'XmartMenu'

affects:
  - marketing SEO metadata
  - superadmin sidebar branding
  - platform_settings app_name rendering

tech-stack:
  added: []
  patterns:
    - Module-level async helper function shared by generateMetadata() and layout body to avoid duplicate DB calls
    - generateMetadata() pattern for dynamic ISR metadata in Next.js App Router layouts

key-files:
  created: []
  modified:
    - src/app/(marketing)/layout.tsx
    - src/app/(superadmin)/layout.tsx

key-decisions:
  - "getPlatformSettings() module-level helper shared by generateMetadata() and MarketingLayout() avoids two separate DB round-trips per ISR window"
  - "createServiceClient() called without await in getPlatformSettings() — it returns a client synchronously (confirmed from server.ts source)"
  - "'Super Admin Console' subtitle stays hardcoded — it is an internal operator label, not a configurable platform value per RESEARCH.md scope decision"
  - "revalidate = 60 added to marketing layout (required for generateMetadata() ISR compatibility — Pitfall 1 from RESEARCH.md)"

patterns-established:
  - "Shared async helper: export async function getPlatformSettings() at module level, called by both generateMetadata and layout body"
  - "Fallback chain: ps?.seo_title ?? ps?.app_name + tagline — gracefully handles null DB values before migration is applied"

requirements-completed: [CFG-04, CFG-06]

duration: 3min
completed: 2026-05-20
---

# Phase 44 Plan 03: Zero Hardcoded Values — Metadata & Superadmin Brand Summary

**generateMetadata() in marketing layout reads seo_title, seo_description, app_name from platform_settings via single shared DB call; superadmin sidebar brand renders configured app_name**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-20T00:00:22Z
- **Completed:** 2026-05-20T00:03:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Replaced static `export const metadata` in (marketing)/layout.tsx with async `generateMetadata()` that reads seo_title, seo_description, and app_name from platform_settings with sensible fallbacks
- Added `export const revalidate = 60` to enable ISR compatibility with dynamic generateMetadata
- Created `getPlatformSettings()` module-level helper shared by generateMetadata and MarketingLayout body — single DB call per request, no duplicate round-trips
- Expanded (superadmin)/layout.tsx platform_settings select to include app_name; sidebar brand link now renders `{ps?.app_name ?? 'XmartMenu'}`

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace static metadata with generateMetadata() in marketing layout** - `d909ff7` (feat)
2. **Task 2: Add app_name to superadmin sidebar brand link** - `cf8e591` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `src/app/(marketing)/layout.tsx` — Replaced static metadata with generateMetadata(); added revalidate=60 and getPlatformSettings() shared helper
- `src/app/(superadmin)/layout.tsx` — Expanded select to include app_name; brand link renders ps?.app_name ?? 'XmartMenu'

## Decisions Made

- `getPlatformSettings()` module-level helper pattern chosen to satisfy Pitfall 5 from RESEARCH.md (avoid two separate platform_settings DB calls per layout render)
- `createServiceClient()` used without `await` in the helper — it returns a Supabase client synchronously (confirmed from server.ts source)
- "Super Admin Console" subtitle intentionally left hardcoded — it is an internal operator label, not a user-facing or configurable string
- `revalidate = 60` added at top of marketing layout file — required for generateMetadata() with ISR (Pitfall 1 from RESEARCH.md)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — TypeScript passed on first attempt, build compiled successfully.

## User Setup Required

None — no external service configuration required. All changes read from the existing platform_settings table populated by Plan 01 migration.

## Next Phase Readiness

- Phase 44 is now complete: all three plans executed
  - Plan 01: DB migration adding seo_title/seo_description/cta_color/app_name columns
  - Plan 02: Landing page SettingsClient wired to platform_settings
  - Plan 03: Marketing layout metadata + superadmin sidebar brand
- Superadmin can configure app_name, seo_title, seo_description in Settings and the changes will reflect in marketing page OG tags and superadmin sidebar within 60 seconds (ISR window)

---
*Phase: 44-zero-hardcoded-values*
*Completed: 2026-05-20*
