---
phase: 13-seo-metadata
plan: "02"
subsystem: seo
tags: [opengraph, og-image, next-og, imageresponse, whatsapp, seo]

dependency_graph:
  requires:
    - phase: 12-core-landing-page
      provides: layout.tsx with metadataBase set to https://xmartmenu.skale.club
    - phase: 13-01
      provides: sitemap.ts, robots.ts, JSON-LD structured data
  provides:
    - opengraph-image.tsx at root app level generating og:image meta tag for /
    - OG image 33421 bytes (32.6 KB) — confirmed under 300 KB WhatsApp gate
  affects: [src/app/opengraph-image.tsx, og:image meta tag on /]

tech-stack:
  added: []
  patterns: [Next.js opengraph-image file convention at root app/ level, not in route group subdirectory]

key-files:
  created:
    - src/app/opengraph-image.tsx
  modified: []
  deleted:
    - src/app/(marketing)/opengraph-image.tsx

key-decisions:
  - "opengraph-image.tsx must be in src/app/ (root), not src/app/(marketing)/ — route-group placement served the route but did not inject og:image into root page head (Rule 1 bug fix)"
  - "Measured OG image size: 33421 bytes (32.6 KB) — well under 300 KB WhatsApp limit"
  - "No fetch() calls in ImageResponse — flat dark CSS (#18181b background, white text) confirmed"

requirements-completed: [SEO-04]

status: awaiting-checkpoint
checkpoint_task: 2
checkpoint_type: human-verify

duration: ~15min
completed: 2026-05-07
---

# Phase 13 Plan 02: OG Image Verification Summary

**OG image file moved to root app level — og:image meta tag now correctly injected at 33.4 KB (32.6 KB), 9x under the 300 KB WhatsApp limit; human verification checkpoint for all four SEO requirements pending.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-07T23:12:44Z
- **Completed:** 2026-05-07 (Task 1 only — checkpoint at Task 2)
- **Tasks:** 1/2 complete (Task 2 awaiting human verification)
- **Files modified:** 1 (moved)

## Accomplishments

### Task 1 — OG image size measured and file location fixed (commit: 5dc6dd3)

**Bug found (Rule 1):** `opengraph-image.tsx` was located in `src/app/(marketing)/opengraph-image.tsx`. While this served the image at the URL `/opengraph-image-pwu6ef`, Next.js did NOT inject the `og:image` meta tag into the root page `<head>` because the file convention must be co-located with the page's route segment level.

**Fix:** Moved `opengraph-image.tsx` to `src/app/opengraph-image.tsx` (root level). After rebuild, the prerendered `index.html` now contains:
```html
<meta property="og:image" content="https://xmartmenu.skale.club/opengraph-image?55d30fe810fa03f5"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="XmartMenu — Your restaurant me..."/>
```

**Measured OG image size:** `33421 bytes` (32.6 KB) — confirmed using:
```bash
wc -c .next/server/app/opengraph-image.body
# 33421
```

This is 9x below the 300 KB WhatsApp limit.

**Verification checks passed:**
- `npm run build` exits 0 (28+ static pages generated)
- `og:image` meta tag now present in prerendered HTML with absolute URL
- No `fetch()` calls in `ImageResponse` — flat dark CSS only
- `metadataBase: new URL('https://xmartmenu.skale.club')` confirmed in `layout.tsx`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] og:image meta tag not injected — opengraph-image.tsx in wrong directory**
- **Found during:** Task 1 (Step A measurement phase)
- **Issue:** Phase 12 placed `opengraph-image.tsx` in `src/app/(marketing)/`. The build served the image at a hashed URL but did not link it to the root `/` route's metadata. The `og:image` meta tag was absent from the prerendered HTML.
- **Fix:** Moved file from `src/app/(marketing)/opengraph-image.tsx` to `src/app/opengraph-image.tsx`. Next.js file convention requires the file to be co-located with the route segment it applies to (root `page.tsx` is at root `src/app/`, so the OG image must be there too).
- **Files modified:** Deleted `src/app/(marketing)/opengraph-image.tsx`, created `src/app/opengraph-image.tsx` (identical content)
- **Commit:** 5dc6dd3

## Checkpoint Status

**Task 2 — Human verification — sitemap, robots, JSON-LD, OG image**

Status: AWAITING HUMAN VERIFICATION

This task requires human verification of production (or local production build) against all four SEO requirements. No automated verification is possible for WhatsApp link preview rendering.

### Verification Steps for Human

**Prerequisites:** Deploy to production OR run `npm run build && npm run start` locally.

**1. Verify sitemap.xml (SEO-01):**
```bash
curl https://xmartmenu.skale.club/sitemap.xml
# OR locally:
curl http://localhost:3000/sitemap.xml
```
Expected: XML with `<loc>https://xmartmenu.skale.club</loc>` only (no tenant slugs).

**2. Verify robots.txt (SEO-02):**
```bash
curl https://xmartmenu.skale.club/robots.txt
# OR locally:
curl http://localhost:3000/robots.txt
```
Expected: Contains `Disallow: /api/`, admin/superadmin paths, and `Sitemap:` line.

**3. Verify JSON-LD (SEO-03):**
Visit https://search.google.com/test/rich-results and enter `https://xmartmenu.skale.club`.
Expected: Organization and SoftwareApplication entities detected, no errors.

Also verify JSON-LD isolation:
```bash
curl -s https://xmartmenu.skale.club/demo | grep "ld+json"
# Expected: No output
```

**4. Verify OG image size (SEO-04):**
```bash
curl -I https://xmartmenu.skale.club/opengraph-image
# Expected: content-length below 300000 bytes
```
Also: Paste `https://xmartmenu.skale.club` into a WhatsApp chat on a real device. The link preview must show the XmartMenu image.

## Known Stubs

None. The OG image uses hardcoded flat CSS values. All four SEO assets (sitemap, robots, JSON-LD, OG image) contain real data.

## Self-Check: PASSED
- `src/app/opengraph-image.tsx` exists at root level
- `src/app/(marketing)/opengraph-image.tsx` deleted
- Build succeeds: 5dc6dd3
- og:image meta tag confirmed in `.next/server/app/index.html`
- Measured size: 33421 bytes
