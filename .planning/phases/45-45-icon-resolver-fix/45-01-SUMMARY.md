---
phase: 45-icon-resolver-fix
plan: "01"
subsystem: ui
tags: [marketing, icons, superadmin, lucide-react, cms]

# Dependency graph
requires:
  - phase: 44-zero-hardcoded-values
    provides: marketing page sections already read landing data from platform_settings

provides:
  - DB-driven icon resolution for marketing HowItWorks and Features sections
  - FoodDrinkCombo renderer for combined food/drink icon display
  - Sandwich and CupSoda availability in superadmin icon picker

affects: [phase-47-features-layout, marketing-cms-icons, superadmin-settings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - String-to-component icon resolver for DB-configured marketing content
    - Composite icon component that strips inherited width/height utility classes before rendering child icons

key-files:
  created: []
  modified:
    - src/app/(marketing)/ClientPage.tsx
    - src/app/(superadmin)/settings/SettingsClient.tsx

key-decisions:
  - "getIcon() returns React.ComponentType<{ className?: string }> rather than LucideIcon so custom FoodDrinkCombo can share the same resolver"
  - "FoodDrinkCombo strips incoming w-* and h-* classes, then applies its own w-4 h-4 sizing so it fits existing marketing icon containers"
  - "FoodDrink remains an internal marketing-page resolver key only; superadmin picker exposes Sandwich and CupSoda separately"

patterns-established:
  - "DB icon fields on landing content should resolve through getIcon(name) instead of array-index fallbacks"

requirements-completed:
  - ICON-01
  - ICON-02
  - ICON-03

# Metrics
duration: ~10min
completed: 2026-05-25
---

# Phase 45 Plan 01: Icon Resolver Fix Summary

**Marketing landing icons now resolve from DB icon strings, and the superadmin picker includes Sandwich and CupSoda for future content updates**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-05-25
- **Tasks:** 4
- **Files modified:** 2

## Accomplishments

- Added `FoodDrinkCombo` to [`src/app/(marketing)/ClientPage.tsx`](C:/Dev/xmartmenu/src/app/(marketing)/ClientPage.tsx) to render `Sandwich` + `CupSoda` as a combined icon while preserving inherited color classes
- Added `getIcon(name)` resolver to the marketing page so landing content now uses DB icon strings instead of hardcoded array-index icon selection
- Updated both `resolvedSteps` and `resolvedFeatures` to call `getIcon(...)`, unlocking real CMS-driven icon changes
- Expanded the superadmin icon picker in [`src/app/(superadmin)/settings/SettingsClient.tsx`](C:/Dev/xmartmenu/src/app/(superadmin)/settings/SettingsClient.tsx) with `Sandwich` and `CupSoda`

## Files Created/Modified

- `src/app/(marketing)/ClientPage.tsx` - added `FoodDrinkCombo`, `getIcon()`, and DB-driven icon resolution in both landing sections
- `src/app/(superadmin)/settings/SettingsClient.tsx` - added `Sandwich` and `CupSoda` imports plus picker options

## Decisions Made

- Resolver fallback is `Globe` for unknown icon names, keeping the marketing page safe if DB content drifts
- `FoodDrink` was not added to `ICON_OPTIONS`; it remains an internal composite renderer rather than a standalone admin choice
- Verification used `cmd /c npx tsc --noEmit` because PowerShell execution policy blocked `npx.ps1`

## Deviations from Plan

None. The implementation matched the plan scope exactly.

## Issues Encountered

- PowerShell blocked direct `npx tsc --noEmit` execution via `npx.ps1`; rerunning through `cmd /c` resolved verification without changing local execution policy

## User Setup Required

None.

## Next Phase Readiness

- Phase 45 is complete and unblocks Phase 47's `FoodDrinkCombo` usage in the features layout work
- Phases 46 and 48 can proceed in parallel, with Phase 49 remaining blocked until 45–48 are visually confirmed

---
*Phase: 45-icon-resolver-fix*
*Completed: 2026-05-25*
