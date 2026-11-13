# Menu image framing

## Review status: under evaluation

Owner review on 2026-11-12 found that the wider Aurora images look good as assets but are not yet approved across every presentation. The fullscreen feed clips the serving and places it beneath the caption; the detail's top-biased crop leaves the dish below the visual center. **The cross-context design is not finalized.**

The project requirement is to keep the actual dish/serving visually centered and understandable in the space available to it, with the complete serving visible. A centered image element is not sufficient when its subject is off-center or interface overlays cover it. Evaluate the feed's free visual area between header/progress controls and actual caption content, as well as list cards, featured cards and mobile/desktop detail.

Prefer **one optimized image per dish** when it works across those views. Separate, deliberately composed feed/menu variants are allowed when the same master cannot meet the requirement. Do not generate or store a duplicate by default. If variants become necessary, give them explicit presentation roles rather than adding an unrelated gallery slide. Their byte limits still follow the application media policy.

## Continuous feed scene: current candidate, under evaluation

The owner also requires future replicability across dishes. Use the [repeatable photo recipe](menu-photo-recipe.md): source photo + shared restaurant reference + one of two shape profiles, with fixed composition/optimization/review checks. Avoid bespoke per-item CSS zoom or a chain of picanha-only prompts. The recipe is still a candidate and must be validated across different serving types before a catalog rollout.

The owner rejected the contained-square proposal on 2026-11-12: the background must accompany the photo and fill the entire feed. A visible square/panel, hard horizontal scene boundaries, flat bands or a blurred copy behind an inset photo do not meet the desired result. The food stays complete and centered in the free visual area, while its actual environment continues to all viewport edges.

The current pilot extends the picanha's original scene into a 9:20 portrait: the same plate/food, coherent bar above and continuous stone table below, with room for controls and caption. It is a separately authored feed candidate; the existing square remains the normal-menu source. This is a justified two-composition experiment, not a decision to generate two files for every dish. Explicit feed/menu image roles and per-dish selection remain to be integrated if this composition is approved; adding it as an ordinary extra gallery slide would be wrong.

The local `DishPhoto` feed prototype recognizes the deliberately tall source after loading and presents it as one static, full-viewport image. The old square-source fallback still exists for comparison and is not an accepted final feed treatment. Do not deploy this branch as a finished full-feed solution until source-role selection and the remaining dishes meet the requirement.

Pilot artifacts: `output/feed-framing/fullbleed/picanha-feed-v1.png`, its exact built-in image_gen prompt, and an optimized 540×1200 WebP of 81,584 bytes. The owner then requested a modest zoom and approximately 25% less lower-table gap. Revision `picanha-feed-v2.webp` is 540×1200 and 97,414 bytes, with its source and exact edit prompt retained beside it. Actual-feed screenshots `feed-390-v2.png`, `feed-360-v2.png` and `feed-430-v2.png` show the complete plate and continuous background. Three browser checks pass: viewport-sized cover frame, one image element, and visually reviewed plate bounds inside the viewport and clear of header/caption. The conservative bounding rectangle has only about 1px clearance from the caption at 360×640; the actual rim has more room, but longer captions remain unvalidated. These bounds are visual review, not food detection. See `evidence-v2.json`. No database, production asset or layout deployment changed. The owner still needs to review the visual result and the recipe needs cross-dish validation.

## Earlier contained layout: rejected

Branch `codex/dish-image-framing` tests one existing source per dish:

- Feed: contain the full photo, without foreground zoom or drift, inside a measured rectangle below the header/progress and above the real caption. Measure caption changes and viewport resizing rather than assuming a fixed vertical position. A subtle blurred fill reuses exactly the same responsive source behind the foreground; it is decorative, not another authored photo.
- Detail and featured cards: retain their 4:3 layout and center the crop, removing the earlier 15%/18% top bias. Aurora's authored margins keep the serving within this crop; this is not a guarantee for arbitrary tightly cropped uploads.
- Normal list cards keep their existing centered geometry. No image, video or 3D asset was replaced by this layout experiment.

Production before-captures are in `output/feed-framing/before-*.png`. Local after-captures cover picanha, orange juice and tiramisu at 360×640, 390×844 and 430×932, plus detail and list screens. Browser geometry checks passed for all nine feed cases: the photo frame lies between controls and caption, foreground is contained and static, and decorative/foreground sources match. No page runtime errors were observed. Local browser fixtures use the already-owned wider Aurora files; no catalog data was copied or modified. The development catalog has 19 older items, while production has 20.

The candidate still needs owner visual review, including perceived subject centering, background treatment and photo size on short screens. A full master may look small when caption content leaves little room; source composition, focal metadata or a dedicated feed variant may be preferable in such cases. Full long-description, landscape-phone, mixed-media and real-device review remains open. Do not mark this design approved based only on thumbnail checks or CSS `object-position: center`. See `output/feed-framing/review.html` and `evidence.json` for this review. No layout deployment has been performed.

## Earlier asset work

Owner decision, 2026-11-12: give every Aurora dish more surrounding scene, especially on the left and right, so the complete serving is understandable in menu thumbnails without clipping. Keep the existing evening bar identity: charcoal stone, warm side light, copper and petroleum teal.

## Image authoring

- Use a square master with the entire plate, bowl, board, glass or bottle visible.
- The earlier 15–18% scene margin on each side of a plate/board is a starting point, not a finalized universal framing rule. Its initial target was the central two thirds of the width and the central half of the height.
- Drinks need vertical clearance as well: include the garnish and base, with subject height around 58% of the master.
- Extend the natural scene instead of adding borders, flat padding or stretching food. Preserve ingredients and serving identity.
- Check actual thumbnail crops before publishing: 120×120, a taller 120×160 mobile card, and 156×117 featured imagery with the current 18% vertical object position. These are reference cases, not a guarantee for arbitrarily tall cards or full-screen feed crops.

## Aurora draft batch

The 20 wider-framed masters are in `output/imagegen/aurora-roomy/`; `review.html` compares previous and new thumbnails. `prompt.txt` records the exact built-in image_gen prompt; `manifest.json` records the assets. The sandwich starts from the new bar-style preview; the other 19 start from their existing branded menu image.

Published on 2026-11-12 after owner approval. The 20 images were converted with the shared photo profile (1200px, 100KiB maximum), uploaded under immutable R2 keys, and assigned to existing products and primary image media in one production PostgreSQL transaction. The final set totals 1,844,912 bytes, down from the initial 5,333,552-byte WebP set. Other product fields and AR models were checked unchanged.

The public menu returned all 20 new lightweight URLs. Measured 256px mobile thumbnails range from 7,084 to 12,070 bytes. Initial publication was also checked on the actual sandwich card at mobile (375px) and desktop (1280px) viewports. Evidence and exact URLs are in `live-verification-lightweight.json`, `publication-plan-lightweight.json` and `publication-result-lightweight.json` under the draft directory. Old local source files and R2 objects are retained; `production-before.json` and `production-before-lightweight.json` keep previous image/media references for rollback. No application deploy was needed for this restaurant data change.
