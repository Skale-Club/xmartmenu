---
phase: 19-admin-next-image
plan: 02
subsystem: ui
tags: [next/image, image-optimization, admin, webp, performance]

requires:
  - phase: 19-01
    provides: next/image already configured in next.config.ts with supabase.co remotePatterns

provides:
  - ProductsClient.tsx uses next/image for all product image rendering
  - Admin product list row thumbnails served as WebP with correct 56x56 sizing hints
  - Upload preview modal thumbnails served as WebP with correct 64x64 sizing hints

affects: [admin-ui, product-management, image-optimization]

tech-stack:
  added: []
  patterns:
    - "next/image with fixed width/height replaces bare <img> in admin list and modal previews"
    - "Non-null assertion (!) on getProductImages(product)[0]! inside truthiness guard avoids TS error"

key-files:
  created: []
  modified:
    - src/app/(admin)/menu/products/ProductsClient.tsx

key-decisions:
  - "Remove Tailwind w-14 h-14 / w-16 h-16 from className when next/image takes over sizing — avoids conflicting dimension hints"
  - "Non-null assertion on getProductImages(product)[0]! is safe because it is inside a truthy guard"

patterns-established:
  - "Pattern: Replace bare <img> with <Image width={N} height={N}> and remove matching Tailwind size classes"

requirements-completed: [IMG-05]

duration: 8min
completed: 2026-05-08
---

# Phase 19 Plan 02: Admin ProductsClient next/image Migration Summary

**Replaced two bare `<img>` tags in ProductsClient.tsx with `next/image` `<Image>` — admin product thumbnails and upload previews now served as WebP with correct sizing hints.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-08T03:36:48Z
- **Completed:** 2026-05-08T03:44:31Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments

- Added `import Image from 'next/image'` to ProductsClient.tsx
- Migrated product list row thumbnail from `<img w-14 h-14>` to `<Image width={56} height={56}>` — Next.js Image Optimization delivers WebP at 56x56
- Migrated upload preview modal strip from `<img w-16 h-16>` to `<Image width={64} height={64}>` — previews now also use WebP with correct sizing
- Build passes (exit 0) — existing supabase.co remotePatterns in next.config.ts cover both image sources

## Task Commits

1. **Task 1: Migrate product thumbnail and upload preview img tags to next/image** - `3d2e49f` (feat)

## Files Created/Modified

- `src/app/(admin)/menu/products/ProductsClient.tsx` - Added next/image import; replaced 2 bare img tags with Image components

## Decisions Made

- Removed `w-14 h-14` and `w-16 h-16` from className when migrating — next/image fixed width/height replaces Tailwind dimension classes to avoid conflicting layout hints
- Used non-null assertion `getProductImages(product)[0]!` inside the truthy guard (`getProductImages(product)[0] ? ... : ...`) — TypeScript cannot narrow array index access but the guard guarantees a non-undefined value

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/app/(admin)/menu/products/ProductsClient.tsx` — confirmed modified with Image import and zero bare img tags
- Commit `3d2e49f` — confirmed exists in git log
- Build exits 0 (verified in worktree)
