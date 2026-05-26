---
phase: 48-cta-fullbleed-background-image
plan: "01"
subsystem: ui
tags: [marketing, cta, fullbleed, background-image, layout]

requires: []

provides:
  - Full-bleed CTA card (no max-width constraint)
  - Restaurant background image layer behind CTA text
  - Responsive dark overlay (60%/50%/40% at phone/tablet/desktop)
  - Admin bg_image_url field in CTA settings

affects: [marketing-homepage, superadmin-settings]

tech-stack:
  added: []
  patterns:
    - Absolutely positioned image as card background with overlay for readability
    - Content wrapper gets padding instead of outer section

key-files:
  created:
    - public/images/cta-bg.jpg (deployment asset — must be added separately)
  modified:
    - src/app/(marketing)/ClientPage.tsx
    - src/app/(superadmin)/settings/SettingsClient.tsx

requirements-completed:
  - CTA-01
  - CTA-02
  - CTA-03

duration: ~20min
completed: 2026-05-25
---

# Phase 48 Plan 01: CTA Full-Bleed Background Image Summary

**CTA section now spans full width with a restaurant background image and responsive dark overlay.**

## Accomplishments

- Removed `px-8` from outer `<section>` and `max-w-[1320px] mx-auto` from card div — card spans edge-to-edge
- Added `overflow-hidden` to card to clip the background image at rounded corners
- Added background `<img>` with `absolute inset-0 w-full h-full object-cover` + dark overlay `bg-zinc-950/60 md:bg-zinc-950/50 lg:bg-zinc-950/40`
- Moved padding to content wrapper: `<div className="relative z-20 max-w-[1320px] mx-auto px-8 sm:px-20 py-20 text-center">`
- Heading, subtext, and button classes preserved byte-for-byte
- Added `bg_image_url?: string` to `CtaData` interface and `DEFAULT_LANDING.cta`
- Added `bg_image_url` input field in superadmin CTA settings section

## Decisions Made

- Image path `public/images/cta-bg.jpg` used as default fallback; `data?.bg_image_url` allows CMS override
- Overlay breakpoints follow SEED-028 spec: 60%/50%/40% (phone/tablet/desktop)
- Text zero-modification constraint respected — only structural wrapper changed
---
*Phase: 48-cta-fullbleed-background-image*
*Completed: 2026-05-25*
