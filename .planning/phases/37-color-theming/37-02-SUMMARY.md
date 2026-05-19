---
phase: 37-color-theming
plan: 02
subsystem: ui
tags: [tailwind, css-variables, color-theming, onboarding, next.js]

# Dependency graph
requires:
  - phase: 37-color-theming-plan-01
    provides: CSS vars --primary/--accent injected server-side, color-utils.ts utility, BrandingClient preset chips
provides:
  - Zero hardcoded indigo-* classes in MenuPage.tsx, CartModal.tsx, ProductModal.tsx (THEME-03 full coverage)
  - Cart badge dynamically colored via tenant primaryColor + text-primary-foreground
  - CartModal accent fallback updated from indigo #6366f1 to platform dark #09090b
  - MenuPage primaryColor/accentColor fallbacks match platform defaults (#EEFF00 / #09090b)
  - CUISINE_PALETTES smart defaults in onboarding API (pizza, japanese, burger, cafe, churrascaria)
  - New tenant_settings rows seeded with primary_color + accent_color from business_type on creation
affects: [phase-38-order-types, tenant-onboarding-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cuisine-type → color palette lookup at tenant creation time; unknown types fall back to platform defaults"
    - "Dynamic inline style={{ backgroundColor: primaryColor }} for elements that cannot use CSS var utilities"

key-files:
  created: []
  modified:
    - src/components/menu/MenuPage.tsx
    - src/components/menu/CartModal.tsx
    - src/app/api/onboarding/route.ts

key-decisions:
  - "ProductModal.tsx: confirmed clean — 0 indigo classes, no changes needed"
  - "CartModal accent fallback changed from #6366f1 (indigo) to #09090b (platform dark) — indigo was a placeholder from before tenant theming existed"
  - "CUISINE_PALETTES looks up raw business_type (lowercased), not safeMenuPurpose — safeMenuPurpose maps pizza→restaurant which would lose the pizza-specific palette"
  - "defaultPalette fallback #EEFF00/#09090b matches platform defaults established in globals.css and MenuPage fallbacks"

patterns-established:
  - "Color fallback consistency: all fallbacks (#EEFF00 primary, #09090b accent) must match across globals.css :root, MenuPage.tsx, and onboarding API"

requirements-completed: [THEME-03, THEME-04]

# Metrics
duration: 8min
completed: 2026-05-19
---

# Phase 37 Plan 02: Color Theming Surface Coverage Summary

**Complete indigo-color elimination from public menu components and smart cuisine-type palette injection at tenant creation**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-19T14:32:00Z
- **Completed:** 2026-05-19T14:40:51Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Eliminated all 4 hardcoded `indigo-*` Tailwind classes from MenuPage.tsx — cart badge, View Details link, footer hover, Hours modal clock
- Cart badge now dynamically colored via `style={{ backgroundColor: primaryColor }}` with `text-primary-foreground` foreground
- Fixed MenuPage.tsx fallback colors: `#000000` → `#EEFF00` (primary), `#FF5722` → `#09090b` (accent)
- CartModal accent fallback updated from indigo placeholder `#6366f1` to platform dark `#09090b`
- ProductModal.tsx confirmed clean — 0 indigo classes, no changes needed
- Added `CUISINE_PALETTES` to onboarding API: 5 cuisine presets (pizza #E74C3C, japanese #C0392B, burger #F39C12, cafe #6F4E37, churrascaria #27AE60)
- New tenant creation now inserts `primary_color` + `accent_color` in `tenant_settings` based on `business_type`
- TypeScript check: 0 errors (`npx tsc --noEmit` clean)

## Task Commits

Each task was committed atomically:

1. **Task 1: Audit and fix hardcoded colors in MenuPage.tsx, CartModal.tsx, ProductModal.tsx** - `5f2edd3` (feat)
2. **Task 2: Add smart default palette to onboarding API tenant_settings insert** - `5ff9a72` (feat)

## Files Created/Modified
- `src/components/menu/MenuPage.tsx` — Fixed fallbacks (#EEFF00/#09090b), eliminated 4 indigo classes, cart badge uses dynamic primaryColor
- `src/components/menu/CartModal.tsx` — Accent fallback changed from #6366f1 to #09090b
- `src/app/api/onboarding/route.ts` — CUISINE_PALETTES constant + defaultPalette lookup + primary_color/accent_color in tenant_settings insert

## Decisions Made
- Looked up palette using raw `business_type` (lowercased), not `safeMenuPurpose` — avoids losing pizza-specific palette that maps to 'restaurant' after sanitization
- ProductModal.tsx was already clean (no indigo classes) — confirmed via grep, no edit needed
- `#09090b` chosen as accent fallback to match globals.css `:root --accent` and be a sensible near-black for text-on-light backgrounds

## Deviations from Plan

None — plan executed exactly as written. ProductModal.tsx was confirmed clean as expected (the plan's conditional "if no matches, make NO changes" branch was taken).

## Known Stubs

None — all color changes are fully wired to tenant data from database.

---

## Self-Check: PASSED

- FOUND: src/components/menu/MenuPage.tsx
- FOUND: src/components/menu/CartModal.tsx
- FOUND: src/app/api/onboarding/route.ts
- FOUND: .planning/phases/37-color-theming/37-02-SUMMARY.md
- FOUND commit: 5f2edd3 (Task 1)
- FOUND commit: 5ff9a72 (Task 2)
