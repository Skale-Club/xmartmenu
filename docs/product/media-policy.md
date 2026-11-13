# Application-wide media policy

Owner direction, 2026-11-12: every image and video must enter the application optimized, keep pages fast, and avoid overloading the shared server. This is a mandatory engineering and publication rule, not a claim that all existing paths already comply.

## Scope and publication boundary

This policy covers every restaurant and screen: menus, products, branding, landing pages, blog, authentication, admin previews, posters, and checked-in assets. It applies to uploads, AI generation, imports, seeds, migration scripts, bulk repairs, and direct storage/database or production edits. File extensions and client compression alone do not prove compliance.

Sources may enter bounded, private staging for processing. Staging is not publication: never assign an original/staging URL to a public media field or component. Retain originals privately when needed for recovery, with retention and cleanup limits. Publish only a verified optimized derivative, after all required artifacts succeed; keep the previous valid asset on failure. Conversion unavailable, failed, or oversized must produce a clear API error or explicit failed-processing status, never publish raw bytes as a fallback. A larger workflow may omit optional media (for example, publish a blog post without a failed cover), while recording that media failure.

External embeds must use lightweight posters, lazy loading and explicit playback where appropriate. Do not force downloading/re-encoding third-party video; evaluate its embed delivery separately and avoid eager third-party players across a menu list. Imported assets we store and serve must pass our ingestion policy. Legacy external URLs are not evidence of compliance.

## Image contract

The authoritative raster encoder is `src/lib/media/optimize-image.ts`; shared limits live in `image-policy.ts` and are used by `src/lib/upload.ts` and native tenant image ingestion. The current profiles cap the **actual encoded output**, not estimated compression:

| Profile | Maximum long edge | Maximum encoded bytes |
| --- | --- | --- |
| Photo / ordinary product image | 1200 px | 100 KiB |
| Wide / banner / blog cover / hero poster | 1200 px | 180 KiB |
| Logo / favicon upload | 512 px | 40 KiB |

Use WebP for general raster delivery; preserve orientation, transparency and intended animation, and remove unnecessary metadata. Reduce quality and then dimensions to meet the budget; reject if content cannot fit. Browser preprocessing reduces transfer, but the server verifies its own output. See [image implementation and rollout evidence](image-optimization.md).

Weight compliance does not prove presentation quality. Review serving visibility and subject centering in the feed's actual free visual area, cards and detail screens before accepting a menu image/layout. The [cross-context framing review](menu-image-framing.md) remains under evaluation: prefer one optimized master per dish, and introduce an explicit context-specific variant only when the shared image cannot work. Do not treat the current Aurora experiment as a finalized design.

SVG, flags, PWA/platform icons, generated social images and AR textures retain formats required by their consumers. They are not exemptions from optimization or weight limits: define and verify an explicit format/use-specific byte and dimension budget, preserve required semantics, and document the reason. Internal OCR inputs currently use 2000 px / 500 KiB for readability; that is not a display-image allowance.

Deliver image sizes appropriate to rendered dimensions with responsive sources and `sizes`, reserve layout space, lazy-load offscreen media, and prioritize only the visible critical asset. Use the existing delivery component where supported. Serve cacheable derivatives through storage/CDN with versioned URLs and appropriate cache headers. Precompute derivatives or use bounded, cached image delivery; Next Image cache misses are acceptable with bounded allowed sizes and resource controls. Do not allow unbounded guest-triggered re-encoding or retranscode video per view.

## Video contract and current implementation

All owned video publication must transcode to a bounded delivery profile, verify the resulting bytes and generate an optimized poster. Existing ffmpeg output is H.264 MP4, `yuv420p`, without audio, with fast-start metadata. These are the **current code settings** in `src/lib/media/video.ts`:

| Profile | Maximum short side | Duration | FPS | Encoding | Bitrate ceiling | Encode timeout |
| --- | --- | --- | --- | --- | --- | --- |
| Dish | 720 px | 60 s | 30 | CRF 28, veryfast | None | 180 s |
| Hero | 1080 px | 45 s | 24 | CRF 24, medium | 3000 kbit/s | 420 s |

These pixel limits are on the **short side**, not the long edge. CRF and a bitrate ceiling do not constitute an enforced file-byte ceiling. Each video profile must also define an explicit maximum encoded output size; verify it before storage/public assignment, and retry within bounded quality/dimension/duration settings or reject. The numeric output ceilings remain to be chosen and implemented with representative footage and delivery evidence; none is enforced by the current encoder.

For guests, load posters first, defer video sources until needed, and bound simultaneous playback. Autoplay video must be muted and inline; pause offscreen media and honor reduced-motion/data preferences with a poster or explicit playback. Do not preload every full clip or fetch large decorative background video on screens where it is unused. CDN caching reduces delivery load; it does not control ingestion/transcoding CPU.

## Protect the shared server

Before buffering or decoding, bound request/download bytes, duration, dimensions, pixels/frame count and allowed formats; inspect actual content rather than trusting MIME alone. Apply authentication, tenant authorization, rate limits and quotas to ingestion. Signed uploads need server-enforced source-size validation as well as client checks.

Use a bounded queue with backpressure and bounded concurrency across all workers/replicas sharing resources. Set explicit encoder thread/CPU, memory, temporary-disk and execution-time budgets; clean temporary files on success, cancellation and failure. Avoid keeping whole waiting uploads in RAM. Reject or defer excess work clearly, isolate heavy workers from guest rendering, and observe queue depth, failures, input/output bytes, time and resource use. Images and bulk scripts need these controls too. Do not repeat costly transformations per view; permitted cached image derivatives still need bounded variant counts and processing.

## Known gaps to close

As inspected on 2026-11-12, these are follow-up work, **not fixes delivered by this document**:

- `video.ts` returns an untouched MP4/WebM when ffmpeg is missing. Dish upload and legacy superadmin platform upload can publish that fallback. The signed hero encode route rejects `transcoded: false`; apply that fail-closed behavior consistently.
- Neither video profile enforces output bytes; dish has no bitrate ceiling. Posters can fail without preventing video publication.
- The encode queue is unbounded in memory; concurrency defaults to one per Node process and does not coordinate replicas. Explicit ffmpeg thread/memory/temp-disk caps are absent.
- Dish and legacy platform routes parse multipart before checking file size. Their source caps are 120 MiB and 50 MiB respectively, not early wire-body protection.
- Hero signed upload uses staging in a publicly served bucket and returns a public URL. The encode route downloads the full source without a maximum byte argument; the 200 MiB hero constant/client limit is not a server-side staging/download bound. Private staging and bounded reads remain required.

The image detail document distinguishes prepared working-tree changes from production evidence. This policy does not imply a global deployment or a completed legacy-media audit.

## Definition of done and release gate

For each new or changed media path, identify its profile, source bounds, optimized output byte cap, publication boundary, delivery behavior and resource limits. Reuse the shared pipeline; do not add bypasses. Before calling it complete:

1. Measure actual stored/output bytes and decoded dimensions/duration/FPS on representative and difficult inputs; verify MIME/extension, animation/alpha/orientation where relevant, and poster/playback correctness.
2. Exercise oversized/corrupt inputs, unavailable converters, timeouts and queue saturation. Show clear failures, bounded resource use and no raw/staging publication or partial replacement.
3. Check guest network behavior at mobile and desktop sizes: responsive images, cache reuse, poster-first/lazy video, no eager full-list downloads, and no repeated uncached origin transformations.
4. Keep targeted regression checks for profile budgets and ingestion/publication paths; audit changed checked-in assets and scripts. Record evidence, remaining gaps and profile changes as Journal decisions. Routine tuning needs evidence and documentation, not a separate approval ceremony.

Changes to a format-specific profile must document scope, reason, measured limits and follow-up in the Journal; they must not silently permit unoptimized publication. Existing production-data and deployment authorization rules still apply. Do not mark unresolved mandatory controls compliant or deploy a new bypass.
