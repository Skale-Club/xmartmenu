# Lightweight images

Application-wide mandate: [Media optimization policy](media-policy.md). That policy covers every image and video ingestion/publication path and server-resource limits. This document describes the image implementation and its rollout evidence.

Owner-approved direction, 2026-11-12: WebP must be lightweight across the application, not merely use a `.webp` extension.

## Authoritative encoding policy

`src/lib/media/image-policy.ts` defines the shared limits. `optimize-image.ts` rotates EXIF-oriented input, preserves transparency and animation, strips metadata, and iterates quality then dimensions until the actual encoded bytes fit.

| Profile | Maximum long edge | Maximum stored bytes |
| --- | --- | --- |
| Photo / product / ordinary image | 1200px | 100KiB |
| Banner / blog cover / hero poster | 1200px | 180KiB |
| Logo / favicon | 512px | 40KiB |

`src/lib/upload.ts` applies the policy to manual uploads and generated buffers. Branding, platform and native tenant-effect routes choose the corresponding profile. MIME and extension describe the actual output; vector SVG stays SVG and must fit the selected byte budget. Corrupt/unencodable inputs fail instead of publishing an oversized original. Blog generation can publish without a cover when encoding fails.

Browser preprocessing shares the limits for JPEG/static PNG input, respects orientation and alpha, and avoids canvas-flattening GIF, WebP, AVIF or APNG animations. The server remains authoritative for every stored raster. OCR document inputs have an explicit internal 2000px/500KiB allowance to retain readable text; they are not displayed menu assets.

## Delivery

`DeliveryImage` uses Next Image and rendered `sizes` for known local, R2, public Supabase Storage and Unsplash raster sources. It covers public blog images and the remaining branding/auth/admin preview surfaces. Unsupported legacy external URLs and vectors retain direct delivery for compatibility. Unknown third-party sources are not claimed to meet our storage budget. Small SVG flags, platform/PWA PNG icons, generated social images, video and AR textures keep their format-specific paths.

## Existing assets and production evidence

- Recompressed all 82 checked-in WebP files with `scripts/optimize-public-images.ts --apply`: 16,241,370 → 6,526,914 bytes (about 60% saved). Backups and a per-file report live under `output/image-optimization/`. Paths and formats remain stable. These repository changes require an application release to reach production.
- Published all 20 wider Aurora images to production using the same photo encoder: 5,333,552 → 1,844,912 bytes (about 65% saved), each source at most 100KiB. Updated only product image fields and primary image media, in one tenant-locked transaction. Preserved unrelated product fields, old objects and AR rows.
- The live Aurora page references all 20 lightweight URLs. Actual 256px WebP thumbnail responses measured 7,084–12,070 bytes. Publication evidence and pre-change snapshots live in `output/imagegen/aurora-roomy/`.

## Verification and rollout

Focused real-Sharp tests cover noisy sources, byte/pixel caps, orientation, metadata removal, transparency, GIF frames/timing, SVG MIME and oversize rejection. Browser-compression tests cover skip/animation/alpha fallbacks. Delivery tests cover URL compatibility and responsive source selection. A checked-in asset budget test prevents oversized local WebP files from returning.

The Aurora data update is live. Global upload/delivery code and optimized local assets are prepared in the working tree; production code deployment is pending owner approval. Do not run the historical Supabase image migration against production: owned PostgreSQL/R2 is the production source, and the legacy HTTP migration is disabled in owned mode.
