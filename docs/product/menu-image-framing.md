# Menu image framing

## Current status: approved composition, catalog rollout in progress

The owner approved the revised picanha v2 continuous full-bleed feed screenshot, then requested this treatment for all 57 products: Aurora 20, Bella Vista 19, Celes Confections 18 (including two unavailable products), together with corrected main images. The composition is approved; generation, encoded-file verification and full catalog review are in progress. No complete production rollout or runtime deployment is claimed here.

Keep the actual dish/serving visually centered and understandable, including its complete rim/base/garnish, without a caption collision. Centering the image element alone is insufficient when the subject is off-center. Review actual short/tall feed viewports and normal cards, featured cards and detail.

## Explicit photo roles and current implementation

Use the standardized [photo recipe](menu-photo-recipe.md), version `feed-v2-main-v1`: original photo + name + shape (`plate` or `tall`) + shared tenant style. Main is a centered 1:1 source with serving width at most 70% and height at most 58%. Feed is a continuous 9:20 scene with the complete serving inside x=4–96%, y=22–56%; the tall profile must include its base and garnish. No growing edit chain, food borrowing, per-dish CSS or Celes staging props/signs/labels/text.

`products.feed_image_url` is optional/nullable and supplies the authored feed still when present. `image_url` and `image_urls` stay the main/gallery role; portraits never enter the ordinary carousel. Existing videos remain in the feed. Missing feed URLs fall back to the existing gallery/media using full-scene cover, with no inset.

The prepared runtime uses one immediate cover image in `DishPhoto`, including the explicit feed source. It has no image-load aspect switch, measured inset fallback, duplicate decorative blur or drift/zoom. Detail and featured crops retain their container geometry and remove the earlier 15%/18% top bias. Upstream endless feed navigation, guest-controlled dish changes, horizontal media track, shared DishHeading and tenant color roles are preserved.

Both image roles pass the shared WebP encoder and actual photo limits: at most 1200px longest edge and 100KiB. The encoder can reduce dimensions to meet bytes, including 1100px outputs. Source PNGs are retained for recovery/review and are not public delivery files.

The additive owned feed-field migration has been applied by the root operator on the intended owned PostgreSQL host, with schema backup; product assignments and runtime release are separate steps. A present database column does not demonstrate that the complete catalog or deployed app uses it.

## Review evidence

Picanha pilot history: `output/feed-framing/fullbleed/picanha-feed-v1.png` and its exact prompt produced a 540×1200 WebP of 81,584 bytes. The owner requested a modest zoom and approximately 25% less lower-table gap. Revision `picanha-feed-v2.webp` is 540×1200 and 97,414 bytes, with source and exact prompt retained. Actual-feed v2 screenshots at 360×640, 390×844 and 430×932 show one full-viewport cover image and complete scene; conservative visual bounds were particularly tight on 360×640. The owner subsequently approved that revised screenshot and requested the catalog rollout.

Current catalog artifacts, exact expanded prompts, sources, hashes, role metadata and contact sheets are under `output/catalog-photo-rollout/`. The `review/` harness uses actual latest MenuFeed, ProductModal and DishPhoto with exported real descriptions, prices, tags and tenant colors. It captures all available products at 360×640, 390×844 and 430×932, plus main 4:3/square/3:4 crops and detail. Its README documents the Next Image/AR stubs and single-product fixture limits. Geometry checks are not automatic food detection, delivery/CDN verification or production proof.

First review covers a bowl (Porcini Risotto), dessert (Lemon) and tall drink (Aperol Spritz). At 360×640 their serving remains complete and clear of the caption; Aperol's base-to-caption gap is tight and needs continued attention across the catalog. Full 57-product visual acceptance, final bytes, guest delivery and publication verification remain open.

## Earlier contained layout: rejected

Historical rejected prototype on `codex/dish-image-framing` tested one existing source per dish:

- Feed: contain the full photo, without foreground zoom or drift, inside a measured rectangle below the header/progress and above the real caption. Measure caption changes and viewport resizing rather than assuming a fixed vertical position. A subtle blurred fill reuses exactly the same responsive source behind the foreground; it is decorative, not another authored photo.
- Detail and featured cards: retain their 4:3 layout and center the crop, removing the earlier 15%/18% top bias. Aurora's authored margins keep the serving within this crop; this is not a guarantee for arbitrary tightly cropped uploads.
- Normal list cards keep their existing centered geometry. No image, video or 3D asset was replaced by this layout experiment.

Production before-captures are in `output/feed-framing/before-*.png`. Local after-captures cover picanha, orange juice and tiramisu at 360×640, 390×844 and 430×932, plus detail and list screens. Browser geometry checks passed for all nine feed cases: the photo frame lies between controls and caption, foreground is contained and static, and decorative/foreground sources match. No page runtime errors were observed. Local browser fixtures use the already-owned wider Aurora files; no catalog data was copied or modified. The development catalog has 19 older items, while production has 20.

This contained candidate was rejected in favor of a continuous authored full-bleed scene. Its measurements remain historical evidence only. A full master may look small when caption content leaves little room; source composition, focal metadata or a dedicated feed variant may be preferable in such cases. Full long-description, landscape-phone, mixed-media and real-device review remains open. Do not mark this design approved based only on thumbnail checks or CSS `object-position: center`. See `output/feed-framing/review.html` and `evidence.json` for this review. No layout deployment has been performed.

## Earlier asset work

Owner decision, 2026-11-12: give every Aurora dish more surrounding scene, especially on the left and right, so the complete serving is understandable in menu thumbnails without clipping. Keep the existing evening bar identity: charcoal stone, warm side light, copper and petroleum teal.

## Image authoring

- Use a square master with the entire plate, bowl, board, glass or bottle visible.
- The earlier 15–18% scene margin on each side of a plate/board is a starting point, not a finalized universal framing rule. Its initial target was the central two thirds of the width and the central half of the height.
- Drinks need vertical clearance as well: include the garnish and base, with subject height around 58% of the master.
- Extend the natural scene instead of adding borders, flat padding or stretching food. Preserve ingredients and serving identity.
- Check actual thumbnail crops before publishing: 120×120, a taller 120×160 mobile card, and 156×117 featured imagery with the then-current 18% vertical object position (since replaced locally by centered cover). These are reference cases, not a guarantee for arbitrarily tall cards or full-screen feed crops.

## Aurora draft batch

The 20 wider-framed masters are in `output/imagegen/aurora-roomy/`; `review.html` compares previous and new thumbnails. `prompt.txt` records the exact built-in image_gen prompt; `manifest.json` records the assets. The sandwich starts from the new bar-style preview; the other 19 start from their existing branded menu image.

Published on 2026-11-12 after owner approval. The 20 images were converted with the shared photo profile (1200px, 100KiB maximum), uploaded under immutable R2 keys, and assigned to existing products and primary image media in one production PostgreSQL transaction. The final set totals 1,844,912 bytes, down from the initial 5,333,552-byte WebP set. Other product fields and AR models were checked unchanged.

The public menu returned all 20 new lightweight URLs. Measured 256px mobile thumbnails range from 7,084 to 12,070 bytes. Initial publication was also checked on the actual sandwich card at mobile (375px) and desktop (1280px) viewports. Evidence and exact URLs are in `live-verification-lightweight.json`, `publication-plan-lightweight.json` and `publication-result-lightweight.json` under the draft directory. Old local source files and R2 objects are retained; `production-before.json` and `production-before-lightweight.json` keep previous image/media references for rollback. No application deploy was needed for this restaurant data change.

## Shared portrait crop refinement

After visual comparison across all 20 Aurora products at 360×640, the reviewed shared crop is `object-position: center 65%` **only for an explicit `feed_image_url` source**. URL role matching happens before any image load; no aspect detection or per-dish CSS is involved. Main/gallery images and legacy feed fallbacks remain centered. With a 9:20 source, this moves the scene up about 24px on 360×640 and only about 3.4px on 390×844, preserving the approved taller-screen composition while improving dense-caption clearance.

The long Filet Madeira title was the limiting first-pass case: at centered cover its recipe rectangle overlapped the first caption by about 19.6px; the shared 65% crop leaves about 4.4px conservative clearance (the actual plate rim has more space). Mojito and Cola garnish remained clear of header/progress controls in visual review. Evidence is retained under `output/catalog-photo-rollout/review/crop-65/`. Recipe bounds are not food detection. Long captions, expanded details and each remaining catalog image still need visual QA; this refinement is not proof of a completed production rollout.
