# Repeatable menu photo recipe

Status: under evaluation with the owner, 2026-11-12. The composition must be practical to repeat for other dishes, not a custom picanha-only art direction. Keep a versioned recipe and source references; generative output still needs visual review and is not pixel-deterministic.

## Inputs: only what changes

1. The existing dish photo (the identity reference; preserve serving, ingredients and vessel).
2. Dish name and one shape: `plate` (plates, bowls, boards, ordinary desserts) or `tall` (glass, bottle, tower-shaped serving).
3. The restaurant's established style reference, reused across the batch. Do not redesign the venue for each dish.

Start from a clean source each time rather than repeatedly editing previous generations. Keep the accepted crop/zoom in the versioned recipe, not in a growing chain of one-off instructions. Prefer one source/master per dish; use a role-specific derivative when one composition cannot meet both feed and menu requirements. Do not mix the feed derivative into the normal photo carousel.

## Fixed feed composition

- Portrait 9:20, one continuous actual scene to all four edges. No inset rectangle, flat bands, collage or blurred-copy fill.
- Full serving, including rim/base/garnish, within 4–96% of canvas width and 22–56% of canvas height. These are authoring targets, not automatic food detection.
- `plate`: serving width about 88–90% of canvas, center about 42% down. Constrain height as well so the complete serving remains above 56%.
- `tall`: keep natural proportions, height up to 34% of canvas, center about 39% down; fit within the same safe rectangle. Do not stretch a glass or crop garnish/base to make it larger.
- Continue the venue above and tabletop below, with a restrained caption-friendly lower region. The owner asked for a modestly closer serving and roughly 25% less visible lower-table gap than the first full-bleed pilot, not an exact universal pixel crop.
- Do not require per-dish CSS zoom or hand-painted background patches. If a subject fails the rectangle, redo the composition under its shape profile or explicitly revise the recipe with evidence.

## Copy-ready generation template

Use the original dish photo as edit target and the restaurant reference as style guidance. Substitute the three bracketed inputs; choose exactly one shape sentence.

```text
Create a full-bleed 9:20 portrait menu-feed photograph of [DISH NAME] from the attached original dish image. Preserve its exact ingredients, serving quantity, vessel, natural proportions and food identity. Match [RESTAURANT STYLE REFERENCE] consistently with the other dishes.

Extend the actual environment naturally above and below: a coherent scene with continuous perspective, lighting, materials and depth of field to every canvas edge. No inset image, seams, flat bands, collage, duplicated blurry fill, UI, text, logos or watermarks.

[PLATE SHAPE: show the complete plate/bowl/board, about 88–90% of canvas width, centered horizontally and around 42% down the canvas. Keep the entire serving within x=4–96%, y=22–56%. Reduce scale only as needed to fit the complete serving, never crop its rim.]
[TALL SHAPE: show the entire glass/bottle/tall serving including garnish and base, centered horizontally around 39% down, no more than 34% of canvas height. Keep natural proportions and fit within x=4–96%, y=22–56%.]

Give the serving clear visual presence while leaving coherent ambience above and continuous subdued tabletop below for feed controls and caption. Avoid excessive empty lower tabletop. This must look like one real photograph, not a photo laid over a background.
```

## Repeatable checks, not one-off approval by dish

Encode with the shared photo policy (1200px long edge, at most 100KiB); save source, recipe version, prompt and final WebP. Reuse the standard pipeline rather than a new compression script for each batch.

Check the real feed at 360×640, 390×844 and 430×932 with its actual controls/caption, plus normal cards, featured and detail. Verify complete serving, visual center, continuous edges, no overlay collision and readable food. Confirm bytes, responsive sources and no extra decorative image download. A single-image solution must pass every context; a portrait derivative is not automatically suitable for normal-menu crops.

The current pilot covers picanha only. Validate the same recipe on at least a bowl/ordinary dish, a dessert and a tall drink before declaring it a reusable production standard or regenerating an entire catalog. If any requires manual special treatment, document that limitation and improve the shared shape profile. Do not silently introduce per-product layout hacks.

See [framing review](menu-image-framing.md) and [mandatory media policy](media-policy.md). No mass regeneration or deployment is implied by this recipe.
