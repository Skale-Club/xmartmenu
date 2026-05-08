---
phase: 19-admin-next-image
plan: 01
subsystem: ui
tags: [next/image, image-optimization, branding, admin]

# Dependency graph
requires:
  - phase: 18-upload-pipeline
    provides: Supabase tenant-assets storage bucket and remotePatterns in next.config.ts
provides:
  - Admin branding page logo and banner previews using next/image with WebP optimization
affects: [public-menu, branding]

# Tech tracking
tech-stack:
  added: []
  patterns: [next/image with fixed width/height for logo, next/image fill+sizes for full-width banner]

key-files:
  created: []
  modified:
    - src/app/(admin)/settings/branding/BrandingClient.tsx

key-decisions:
  - "Logo Image uses fixed width={80} height={80} — parent div is already 80px (w-20 h-20), no w-full h-full classes needed"
  - "Banner Image uses fill+sizes='100vw' with relative parent — enables responsive scaling while maintaining object-cover"

patterns-established:
  - "Fixed-size images (avatars, logos) use width/height props on next/image"
  - "Full-width images (banners, heroes) use fill+sizes on relative-positioned parent"

requirements-completed: [IMG-04]

# Metrics
duration: 5min
completed: 2026-05-08
---

# Phase 19 Plan 01: Admin Branding next/image Migration Summary

**Replaced two bare `<img>` tags in BrandingClient.tsx with next/image Image components — logo uses fixed 80x80, banner uses fill with relative parent**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-08T10:16:39Z
- **Completed:** 2026-05-08T10:22:31Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `import Image from 'next/image'` to BrandingClient.tsx
- Logo preview migrated to `<Image width={80} height={80} className="object-contain">` — automatic WebP, correct sizing hint
- Banner preview migrated to `<Image fill sizes="100vw" className="object-cover">` with `relative` class on parent div
- Zero bare `<img>` tags remain in BrandingClient.tsx
- Build passes (npm run build exits 0 in worktree)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate logo and banner img tags to next/image** - `39d597a` (feat)

## Files Created/Modified
- `src/app/(admin)/settings/branding/BrandingClient.tsx` - Added Image import; replaced logo and banner img elements with next/image Image components

## Decisions Made
- Logo uses `width={80} height={80}` (not fill) since parent div is a fixed 80x80 container — fill would require more complex sizing
- Banner parent div gained `relative` class so `fill` works correctly for responsive full-width display

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- File exists: `src/app/(admin)/settings/branding/BrandingClient.tsx` — FOUND
- Commit exists: `39d597a` — FOUND
- Zero `<img>` tags in BrandingClient.tsx — CONFIRMED (grep returns 0)
- `import Image from 'next/image'` present — CONFIRMED
- Logo `width={80} height={80}` present — CONFIRMED
- Banner `fill sizes="100vw"` with relative parent — CONFIRMED
- Build exits 0 (worktree build) — CONFIRMED
