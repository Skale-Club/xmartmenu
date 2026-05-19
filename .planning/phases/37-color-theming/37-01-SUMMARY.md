---
phase: 37-color-theming
plan: 01
subsystem: ui
tags: [tailwind, css-variables, color-theming, server-components, next.js]

# Dependency graph
requires:
  - phase: 35-custom-domain
    provides: tenant_settings already includes primary_color and accent_color fields
provides:
  - computePrimaryForeground utility (WCAG luminance-based foreground selection)
  - --accent / --accent-foreground CSS vars bridged into Tailwind @theme inline
  - Server-side <style> injection in both public menu page.tsx routes (zero FOUC)
  - 6 cuisine preset chips in BrandingClient Color Palette section
  - text-primary-foreground on save and preview buttons in BrandingClient
affects: [38-color-theming-plan-02, menupage-color-audit, tenant-onboarding-smart-defaults]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Server-side inline <style> injection for zero-FOUC CSS variable overrides in ISR pages
    - WCAG luminance threshold (L > 0.4) for automated foreground color selection
    - Tailwind @theme inline bridging CSS custom vars to utility classes

key-files:
  created:
    - src/lib/color-utils.ts
  modified:
    - src/app/globals.css
    - src/app/(public)/[slug]/page.tsx
    - src/app/(public)/[slug]/[menuSlug]/page.tsx
    - src/app/(admin)/settings/branding/BrandingClient.tsx
    - src/components/menu/MenuPage.tsx

key-decisions:
  - "computePrimaryForeground threshold L > 0.4 → dark text (#09090b), L ≤ 0.4 → white text (#ffffff)"
  - "CSS var injection via inline <style> in page.tsx server component, before MenuPage, eliminates FOUC on ISR pages"
  - "CUISINE_PRESETS constant defined outside component function (module-level) — stable reference, no re-creation on render"
  - "Camera icon used as Instagram proxy in BrandingClient + MenuPage — lucide-react does not export Instagram"

patterns-established:
  - "Zero-FOUC color theming: derive colors from tenant_settings on server, emit <style>:root{...}</style> before client components"
  - "Primary foreground auto-computation: import computePrimaryForeground and call it alongside primaryColor derivation"

requirements-completed: [THEME-01, THEME-02]

# Metrics
duration: 18min
completed: 2026-05-19
---

# Phase 37 Plan 01: Color Theming Infrastructure Summary

**Server-side CSS variable injection for zero-FOUC tenant color theming, plus WCAG luminance foreground utility and 6 cuisine preset chips in the branding admin**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-19T00:00:00Z
- **Completed:** 2026-05-19T00:18:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Created `src/lib/color-utils.ts` with `computePrimaryForeground` using WCAG 2.1 relative luminance
- Added `--accent` / `--accent-foreground` CSS vars to globals.css and bridged into Tailwind `@theme inline`
- Both public menu pages now emit `<style>:root{--primary:X;--primary-foreground:Y;--accent:Z;}</style>` at server render (zero FOUC)
- BrandingClient Color Palette card shows 6 cuisine preset chips (Pizza, Japanese, Burger, Cafe, Churrasco, Default) above the color pickers
- Save and Preview Live buttons updated to use `text-primary-foreground` so text adapts to tenant-chosen primary

## Task Commits

Each task was committed atomically:

1. **Task 1: Create color-utils.ts + patch globals.css --accent vars** - `6a9d53e` (feat)
2. **Task 2: Inject server-side CSS vars in both public page.tsx routes** - `e61e974` (feat)
3. **Task 3: Add cuisine preset chips to BrandingClient Color Palette section** - `f41ea62` (feat)
4. **Deviation fix: Replace Instagram icon with Camera proxy** - `7f4aaba` (fix)

## Files Created/Modified
- `src/lib/color-utils.ts` - WCAG luminance-based computePrimaryForeground utility
- `src/app/globals.css` - Added --accent, --accent-foreground to :root and @theme inline
- `src/app/(public)/[slug]/page.tsx` - Server-side <style> injection with tenant colors
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` - Same server-side <style> injection
- `src/app/(admin)/settings/branding/BrandingClient.tsx` - CUISINE_PRESETS chips, text-primary-foreground, Camera icon fix
- `src/components/menu/MenuPage.tsx` - Camera icon fix (pre-existing Instagram import removed)

## Decisions Made
- `computePrimaryForeground` threshold: L > 0.4 → dark foreground (#09090b), L ≤ 0.4 → white (#ffffff) — aligns with WCAG 2.1 contrast requirements
- Inline `<style>` tag injected before `<ScanRecorder>` and `<MenuPage>` in both public routes — server render guarantees no flash
- `CUISINE_PRESETS` defined at module scope (not inside component) — stable reference, no re-creation cost
- Camera icon used as Instagram proxy to avoid non-existent `Instagram` export from lucide-react (consistent with prior decisions in STATE.md)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing Instagram icon build failure**
- **Found during:** Task 3 verification (npm run build)
- **Issue:** Both `BrandingClient.tsx` and `MenuPage.tsx` imported `Instagram` from `lucide-react`, which does not export that icon. This caused a build failure, blocking completion.
- **Fix:** Removed `Instagram` import from both files; replaced `<Instagram>` JSX with `<Camera>` (same proxy used in marketing page per STATE.md). aria-label already present on relevant elements.
- **Files modified:** src/app/(admin)/settings/branding/BrandingClient.tsx, src/components/menu/MenuPage.tsx
- **Verification:** `npx tsc --noEmit` passes with 0 errors; `npm run build` succeeds
- **Committed in:** 7f4aaba (separate fix commit after Task 3)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking pre-existing issue)
**Impact on plan:** Fix was necessary to pass build gate. No scope creep — only replaced invalid import with Camera proxy, consistent with established project pattern.

## Issues Encountered
- lucide-react does not export `Instagram` — this was a pre-existing bug in BrandingClient and MenuPage that blocked the build verification step. Resolved by applying the Camera proxy pattern already documented in STATE.md decisions.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Color theming infrastructure is complete: CSS vars injected server-side on public menu, Tailwind @theme inline bridged, BrandingClient has preset chips
- Plan 02 can proceed: MenuPage/CartModal/ProductModal color audit + smart defaults at tenant creation in onboarding API
- No blockers

---
*Phase: 37-color-theming*
*Completed: 2026-05-19*
