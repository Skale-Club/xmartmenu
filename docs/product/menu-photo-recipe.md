# Repeatable menu photo recipe

Status: owner-approved and published, 2026-11-13. All 57 products in Aurora (20), Bella Vista (19) and Celes Confections (18, including two still-unavailable products) have separate feed and centered main photos. The 114 WebP files total 9,882,190 bytes. Runtime `a9f2361` is verified live. The [versioned batch manifest](../media/menu-photo-batches/2026-11-13.json) retains public identity sources, exact prompts, output URLs, dimensions, bytes and hashes for future replication; generative output is not pixel-deterministic.

## Inputs and repeatability

Use only the existing dish photo, dish name, one shape profile (`plate` or `tall`), and the restaurant's shared style reference. Start from that clean identity source for each role. Preserve exact ingredients, serving quantity, vessel and natural proportions. Do not borrow food from another dish, chain edits through unrelated generations, add manual per-dish CSS, or redesign the venue for each product.

Shared restaurant styling:

- Aurora: evening bar, charcoal stone tabletop, warm side light, copper details, petroleum-teal linen and softly blurred bar.
- Bella Vista: its existing Italian trattoria setting/tabletop, warm natural light and restrained Italian styling.
- Celes Confections: its existing editorial bakery setting, light tabletop, soft daylight and refined warm neutrals. Do not add staging props, signs, printed menus, brand cards, logos, labels or readable text. Preserve food identity and avoid unrelated decorative sweets.

The selected recipe is `feed-v2-main-v1`. Main and feed are separately authored because a portrait scene cannot guarantee a complete serving in every ordinary-menu crop. Do not add the feed variant to the ordinary gallery.

## Fixed compositions

| Role | Composition and safe profile |
| --- | --- |
| Main | Square 1:1. Complete serving centered horizontally and vertically at canvas center; width at most 70%, height at most 58%. Keep rim, base and garnish complete in square, 3:4 and central 4:3 crops. |
| Feed, plate | Portrait 9:20. Complete plate/bowl/board/tray, about 88–90% of canvas width, centered horizontally around 41% down. Entire serving within x=4–96%, y=22–56%; reduce scale only as needed to keep every edge. |
| Feed, tall | Same portrait and safe rectangle. Entire glass/bottle/tall serving, including garnish and base, natural proportions, no more than 34% of canvas height, center around 39% down. The base is critical: review its clearance above the caption on short screens. |

All edges continue the real scene with coherent perspective, light and materials. No inset panel, seams, flat bands, collage or duplicated blurred background. Keep a modest tabletop gap below the serving; the bottom 40% remains continuous subdued tabletop for controls and captions. These rectangles are authoring targets, not automatic food detection or guaranteed acceptance.

## Standard feed prompt

Attach the original dish image, substitute the name and shared tenant style, and select exactly one shape paragraph. Save the exact expanded prompt with its artifact.

```text
Create a single full-bleed 9:20 portrait restaurant menu feed photograph of [DISH NAME]. EDIT TARGET: attached original dish photograph. Preserve the exact ingredients, serving quantity, vessel, natural proportions and food identity. Restaurant scene: [SHARED TENANT STYLE]. Never borrow food from another product.

Extend the actual environment naturally above and below to all four image edges, with coherent perspective, materials, lighting and depth of field. One real continuous photograph. No inset panel, seams, horizontal bands, collage, duplicated blurry backdrop, text, UI or watermarks.

[PLATE PROFILE: show the complete plate/bowl/board/tray including its rim and all food, about 88–90% of canvas width and centered horizontally around 41% down the canvas. Reduce scale only as needed to include the entire serving.]
[TALL PROFILE: show the complete glass/bottle including garnish and base, at natural proportions, no more than 34% of canvas height, centered horizontally and around 39% down the canvas.]

Keep the complete serving inside x=4–96%, y=22–56%. Give it strong readable presence, with only a modest gap of tabletop below the serving before the lower-caption region. The bottom 40% continues the actual subdued tabletop; the upper region continues the venue. Preserve every edge of the serving. This is a repeatable composition, not a custom design. Output only the one portrait photograph.
STRICT OUTPUT: Do not add any signs, printed menus, brand cards, logos, labels, letters or readable text anywhere in the scene.
```

## Standard main prompt

```text
Create one square 1:1 main restaurant menu photograph of [DISH NAME], editing the attached original. Preserve exact food ingredients, serving quantity, vessel, natural proportions and identity. [SHARED TENANT STYLE]. The complete serving including rim/base/garnish must be horizontally AND vertically centered at canvas center, with generous natural scene margin: width at most 70% and height at most 58%. It must stay complete in square, portrait-card and central 4:3 crops. Naturally extend the same setting to every edge without stretching food. Crisp appetizing food, coherent perspective, soft realistic light. No text, borders, flat padding, collage, watermark or added unrelated dishes. Output only the square photo.
STRICT OUTPUT: Do not add staging props, signs, printed menus, brand cards, logos, labels, letters or readable text anywhere in the scene.
```

## Runtime roles and optimization

`products.feed_image_url` is nullable and optional in the DTO. When present, it supplies the feed's single still scene; existing videos remain. When absent, the existing media/gallery remains the feed fallback. `image_url` and `image_urls` keep the normal-menu/gallery role. Admin edits preserve the dedicated field independently. Never put the portrait in the ordinary carousel.

`DishPhoto` renders one responsive image immediately with `object-cover`: no load-time aspect detection, inset containment, duplicated blur or drift/zoom. Detail and featured sources keep their existing container ratios with a centered crop. Runtime a9f2361 and actual main/feed source selection were verified in production; schema, catalog assignment and release remain distinct checks for future batches.

Both roles use `src/lib/media/optimize-image.ts` and the photo profile: WebP, longest edge at most 1200px, actual encoded output at most 100KiB (102,400 bytes). The shared encoder may reduce dimensions to fit, including 1100px output; 1100px is not a separate allowance. Verify actual bytes and decoded dimensions for every file. Never publish a raw generated source or an oversized conversion fallback.

## Evidence and acceptance

Sources, exact prompts, batch jobs, role artifacts, encoded byte counts, dimensions and SHA-256 records are retained under `output/catalog-photo-rollout/`. `manifest.json` identifies product, role/source and recipe; each saved role has its own JSON record. These local artifacts are review evidence, not a publication claim.

The local review harness under `output/catalog-photo-rollout/review/` mounts actual MenuFeed, ProductModal and DishPhoto using exported real names, descriptions, prices, tags and tenant settings. It captures feed at 360×640, 390×844 and 430×932, normal 4:3/square/3:4 crops and detail, plus tenant contact sheets. Next Image delivery and unused AR imports are stubbed; this verifies framing/layout, not CDN optimization, AR or full production entitlement behavior. See its README and metrics for exact coverage.

Review every complete serving, its perceived center, continuous background, garnish/base/rim clearance and actual caption overlap. A browser rectangle check does not locate food. Tall drinks need special visual attention on 360×640; the reviewed shared explicit-portrait crop is described below, with no per-product layout exception. First cross-shape review includes Porcini Risotto, Lemon and Aperol Spritz; the final review covers all 57 products. Keep rejected outputs separate and regenerate from the clean source under the same profile.

Owned schema: the root operator reports the additive feed-field migration applied on the intended owned PostgreSQL host with a schema-only backup (339,615 bytes), six reviewed files, one previously pending and zero changed. The development migration is also applied. All 57 product references are populated and runtime a9f2361 is verified live. Production asset/data publication and deployment retain their existing authorization and verification rules.

See [framing review](menu-image-framing.md) and [mandatory media policy](media-policy.md).

## Shared portrait crop refinement

After visual comparison across all 20 Aurora products at 360×640, the reviewed shared crop is `object-position: center 65%` **only for an explicit `feed_image_url` source**. URL role matching happens before any image load; no aspect detection or per-dish CSS is involved. Main/gallery images and legacy feed fallbacks remain centered. With a 9:20 source, this moves the scene up about 24px on 360×640 and only about 3.4px on 390×844, preserving the approved taller-screen composition while improving dense-caption clearance.

The long Filet Madeira title was the limiting first-pass case: at centered cover its recipe rectangle overlapped the first caption by about 19.6px; the shared 65% crop leaves about 4.4px conservative clearance (the actual plate rim has more space). Mojito and Cola garnish remained clear of header/progress controls in visual review. Evidence is retained under `output/catalog-photo-rollout/review/crop-65/`. Recipe bounds are not food detection. The final 57-product catalog passed the three viewport checks and public delivery verification. Expanded-description extremes, landscape and physical devices still require separate review.

## Complete-rim retry and measured batch baseline

If a source already clips a vessel or the generated rim touches the canvas, retry from the clean source using the shared complete-rim safety profile: serving width 80–84%, target 8–10% natural tabletop margin on each side, reconstruct the entire vessel, preserve identity and the same vertical safe area. Review the result rather than assuming numeric prompt compliance. Four Bella feed scenes required this retry; no per-product CSS was added.

The first 57-product run used 119 new built-in generation calls, including six rejected outputs, and reused the approved picanha portrait for 114 accepted role assets. Authoring/iteration took approximately 50 minutes with concurrent implementation and review. Final browser framing capture took about two minutes for 285 screenshots; upload/hash verification and assignment took about one minute. CI and deployment are additional wall time. Keep batches resumable and record actual timing rather than treating this first run as a service guarantee.
