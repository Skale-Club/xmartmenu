---
phase: 46-global-color-rebrand
plan: "01"
subsystem: ui
tags: [branding, color, css, globals, fallbacks]

requires:
  - phase: 45-icon-resolver-fix
    provides: marketing page icon infrastructure

provides:
  - Updated CSS default --primary and --primary-foreground variables
  - All #EEFF00 hardcoded fallbacks replaced with #F52323 across 11 files

affects: [all-pages, tenant-branding, onboarding]

tech-stack:
  added: []
  patterns:
    - WCAG foreground flip: #F52323 (red, L<=0.4) requires white foreground

key-files:
  created: []
  modified:
    - src/app/globals.css
    - src/app/(marketing)/layout.tsx
    - src/app/(superadmin)/layout.tsx
    - src/app/(admin)/layout.tsx
    - src/app/(public)/[slug]/page.tsx
    - src/app/(public)/[slug]/[menuSlug]/page.tsx
    - src/app/(public)/[slug]/waiter/page.tsx
    - src/app/(public)/[slug]/me/page.tsx
    - src/app/(public)/[slug]/me/login/page.tsx
    - src/components/menu/MenuPage.tsx
    - src/components/menu/AiChatWidget.tsx
    - src/app/api/onboarding/route.ts
    - src/app/(superadmin)/settings/SettingsClient.tsx
    - src/app/(admin)/settings/branding/BrandingClient.tsx
    - src/app/(marketing)/ClientPage.tsx

requirements-completed:
  - COLOR-01
  - COLOR-02

duration: ~20min
completed: 2026-05-25
---

# Phase 46 Plan 01: Color Rebrand (#EEFF00 → #F52323) Summary

**CSS default and all 14 hardcoded hex fallbacks updated from yellow-lime to red.**

## Accomplishments

- `src/app/globals.css`: `--primary: #F52323` and `--primary-foreground: #ffffff` (foreground flips white — red is dark per WCAG luminance)
- Replaced all 14 `#EEFF00` fallback occurrences across 11 source files with `#F52323`
- Updated superadmin default `cta_color` from `#CBFF00` → `#F52323`
- Updated branding presets `Default` palette primary → `#F52323`
- Hero heading gradient: `via-yellow-200` → `via-red-200` (preserves fade-out effect)
- Feature hover gradient: `to-yellow-500/5` → `to-primary/5` (fully dynamic)

## Decisions Made

- `#F52323` has WCAG relative luminance ≤ 0.4 → foreground must be `#ffffff`
- This commit is intentionally atomic with Plan 02 — committing 01 alone would create dark text on red buttons
---
*Phase: 46-global-color-rebrand*
*Completed: 2026-05-25*
