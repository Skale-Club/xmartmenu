---
id: SEED-006
status: dormant
planted: 2026-05-07
planted_during: v1.4 (Performance) — Phase 14 (Instrumentacao) executing
trigger_when: image payload identified as top-3 contributor in v1.4 Phase 14 baselines, OR before SEED-005 marketing landing page ships at Lighthouse 95+, OR after tenant onboarding ramps and Supabase storage bucket grows past ~1 GB
scope: medium
---

# SEED-006: Image optimization — WebP everywhere + responsive sizes

## Why This Matters

The system *feels* heavy, and images are a likely top contributor to that
perception. Today the pipeline is half-done:

- **Upload converter exists but is bypassed in the hot path.**
  [src/lib/upload.ts](src/lib/upload.ts) converts uploads to WebP @ q85 via
  `sharp`, **but the admin product upload at**
  [src/app/(admin)/menu/products/ProductsClient.tsx:176](src/app/\(admin\)/menu/products/ProductsClient.tsx)
  uploads the raw `File` directly to Supabase Storage with no conversion. That
  means every product photo a tenant uploads through the normal admin UI
  ships as PNG/JPEG at full size — exactly the opposite of what the helper
  was written to enforce.
- **No responsive variants.** Even the routes that *do* convert (e.g.
  [src/app/api/superadmin/tenants/[id]/seed-image/route.ts](src/app/api/superadmin/tenants/\[id\]/seed-image/route.ts))
  emit a single `{tenant}/products/{product_id}.webp` blob. Phones download the
  same multi-thousand-pixel image as desktop.
- **No `next/image`.** Every product, banner, and logo is rendered with a raw
  `<img src=...>` tag (see breadcrumbs below). Without `next/image`, browsers
  download the largest variant, never lazy-load below the fold, and skip the
  `_next/image` optimizer entirely.
- **Legacy storage is unaudited.** Anything uploaded before WebP enforcement
  (or via the still-broken admin path) is sitting in Supabase Storage as
  PNG/JPEG. Nobody has measured how much.

The cumulative effect: the public menu page — the highest-traffic, lowest-
intent route in the product — ships unoptimized image bytes to phones over 4G.
Fixing this is a payload reduction in the **megabytes**, not kilobytes.

## When to Surface

**Trigger:** image payload identified as top-3 contributor in v1.4 Phase 14 baselines, OR before SEED-005 marketing landing page ships at Lighthouse 95+, OR after tenant onboarding ramps and Supabase storage bucket grows past ~1 GB

This seed should be presented during `/gsd:new-milestone` when the milestone
scope matches any of these conditions:
- "Performance" / "image" / "media" / "delivery" milestones (post-v1.4)
- Pre-launch / Lighthouse / Core Web Vitals milestones — landing page perf
  budget gates depend on image weight
- Storage cost / Supabase bucket growth milestones — converting legacy
  uploads is a one-time cost-cutting opportunity
- Mobile experience / 4G / slow-network milestones
- Any milestone touching `MenuPage.tsx` rendering (product cards), branding
  upload, or product upload flow

## Scope Estimate

**Medium** — focused work, plan as ~2-3 phases:

1. **Fix the upload pipeline** — route the admin `ProductsClient` uploader
   through `validateAndConvertToWebP` so every new image lands as WebP. Extend
   `sharp` pipeline to emit responsive variants (e.g. 256w / 512w / 1024w) and
   store them under predictable paths
   (`{tenant}/products/{product_id}-{w}.webp`).
2. **Migrate rendering to `next/image`** — replace raw `<img>` tags in
   `MenuPage.tsx`, `BrandingClient.tsx`, `ProductsClient.tsx`, and the
   superadmin tenant clients. Pass correct `sizes` props per breakpoint so the
   browser picks the right variant. Configure `images.deviceSizes` /
   `imageSizes` in `next.config.ts` to match the variants we emit.
3. **Backfill legacy storage** — one-shot script that lists every object in
   the `product-images` and tenant logo/banner buckets, converts non-WebP
   originals to WebP + responsive variants, updates `image_url` / `image_urls`
   columns, and emits a before/after byte-count report. Idempotent so it can
   re-run.

Optional follow-up (defer unless measurement justifies it):
- AVIF as a second format alongside WebP (smaller still, but more CPU cost on
  upload and uneven Safari support pre-2024).
- CDN headers (`Cache-Control: public, max-age=31536000, immutable`) on
  Supabase Storage — already flagged in SEED-004.

## Breadcrumbs

### Upload pipeline (the bug)
- [src/lib/upload.ts](src/lib/upload.ts) — `validateAndConvertToWebP` and
  `convertBufferToWebP`. Currently single-size, q85, no responsive output.
- [src/app/(admin)/menu/products/ProductsClient.tsx:176](src/app/\(admin\)/menu/products/ProductsClient.tsx)
  — admin product upload bypasses the converter; uploads raw `File` to
  Supabase Storage. **This is the leak that matters most** (highest-volume
  upload path).
- [src/app/api/superadmin/tenants/[id]/upload/route.ts:25](src/app/api/superadmin/tenants/\[id\]/upload/route.ts)
  — superadmin generic upload also writes raw bytes. Audit whether all
  callers go through this and if so, fix at the route level.
- [src/app/api/superadmin/tenants/[id]/seed-image/route.ts](src/app/api/superadmin/tenants/\[id\]/seed-image/route.ts)
  — already converts via `convertBufferToWebP` (lines 97, 187, 293). This is
  the pattern to extend to multiple sizes.

### Rendering (raw `<img>` everywhere)
- [src/components/menu/MenuPage.tsx](src/components/menu/MenuPage.tsx)
  lines 324 (banner), 332 (logo), 478 (product card grid), 707 (modal hero)
  — all `<img src=...>`. Public menu, highest-traffic route. Highest ROI.
- [src/app/(admin)/settings/branding/BrandingClient.tsx](src/app/\(admin\)/settings/branding/BrandingClient.tsx)
  lines 114 (logo), 133 (banner) — admin previews.
- [src/app/(admin)/menu/products/ProductsClient.tsx:432](src/app/\(admin\)/menu/products/ProductsClient.tsx)
  — product image thumbnails in admin grid.
- [src/app/(superadmin)/tenants/TenantsClient.tsx:400](src/app/\(superadmin\)/tenants/TenantsClient.tsx)
  and [src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx:372](src/app/\(superadmin\)/tenants/\[id\]/TenantDetailClient.tsx)
  — superadmin tenant logo previews.

### Config
- [next.config.ts](next.config.ts) — `images.remotePatterns` allows
  `*.supabase.co/storage/v1/object/public/**`. Missing: `formats`,
  `deviceSizes`, `imageSizes`. Set those alongside the rendering migration.
- [src/types/database.ts:81-82](src/types/database.ts) — `image_url: string | null`
  and `image_urls: string[]` schema. Variant URLs can either live in
  `image_urls` (array of size variants) or be derived deterministically from
  the base path. Decide during planning.

### Audit gaps
- No tooling exists to list bucket contents and compute MIME-type / size
  histograms. Phase 1 of execution should produce this report so the legacy
  backfill scope is data-driven.
- Check whether Supabase Storage's built-in image transformation
  (`?width=512&format=webp` query params) is enabled on the project — could
  replace static variant emission for some routes, with a per-request CPU
  trade-off.

### Public folder
- `public/*.svg` (file/globe/next/vercel/window) — Next.js scaffolding leftovers.
  Out of scope; trivially small. Confirm during planning that they are even
  still referenced; if not, delete.

## Notes

- **Coordinates with SEED-004** (system-wide perf). SEED-004 calls out image
  delivery as one of many gaps; SEED-006 is the focused execution of that
  specific gap. If a future perf milestone bundles both, image work is the
  largest single payload-reduction lever and should be sequenced early.
- **Coordinates with SEED-005** (marketing landing page). The landing page
  perf budget targets Lighthouse 95+ on mobile — that budget is unreachable
  if hero/feature imagery isn't already WebP-responsive when it ships. Either
  do this seed first, or constrain the landing page to only use images that
  were converted by hand for the launch.
- **Coordinates with v1.4 Phase 16 (Frontend Performance).** If Phase 14
  baselines surface image weight as the dominant FCP/LCP contributor on
  `/{slug}`, the cleanest move is to absorb the upload-fix and `next/image`
  migration into Phase 16 rather than waiting for a separate milestone.
  Otherwise this seed waits.
- **Backfill is destructive-ish** — overwrites storage objects. Plan needs
  a dry-run mode and a `before/` snapshot path so the operation is reversible
  if a tenant's image becomes corrupted by the converter.
- **Don't ship `next/image` without `sizes`.** Adding `next/image` without a
  correct `sizes` prop can *increase* payload (forces optimizer fetch but
  picks the largest candidate). Audit every migrated image for layout
  context (grid card vs full-width hero vs avatar) and set `sizes`
  accordingly.
- **Test on a real low-end Android over throttled 4G.** Desktop dev numbers
  hide the actual customer experience for restaurant patrons in Brazil,
  who are the primary audience.
- **Tools to consider:** `sharp` (already installed), `next/image`,
  Supabase Storage transformations, `node:fs` + `@supabase/supabase-js`
  for the backfill script, `lighthouse` CI for regression detection on the
  public menu route specifically.
