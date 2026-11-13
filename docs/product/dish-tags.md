# Dish tags

Rule set on 2026-11-12 by the owner. Code: `src/lib/menu/dish-tags.ts`.

## One tag per dish, everywhere

A dish has **one** tag, shown as **one** pill, so it never takes much space:

- the dish card in the public menu (list and grid);
- the visual feed;
- the dish sheet (ProductModal);
- the admin product list and form. The form lets the owner pick one tag:
  tapping another swaps it, tapping the chosen one clears it.

Saving keeps one tag: the admin API (`src/lib/data/admin-products.ts`) and the
MCP product tools run `normalizeTags`, which keeps only the most important tag
when more arrive (older data, API callers). Dishes saved before this rule may
still hold several tags in the database; every screen shows only their most
important one, and the next save trims them.

Do not add a second pill, a tag row or a "+N" counter anywhere. New surfaces
(search results, upsell, featured, etc.) call `primaryTag(product.tags)`.

## One feature pill, one component (owner, 2026-11-12)

A dish shows at most ONE feature pill on every surface: its tag; with no
tag, a dish marked as featured (`is_featured`) shows "Chef's special".
`is_featured` is a placement (the featured row), never a second pill. The
decision is `dishFeature` in `src/lib/menu/dish-tags.ts`; the pill is
`src/components/menu/DishFeaturePill.tsx` (shape and type from the visual
feed; `glass` over photos, `solid` on light surfaces), used by the feed, the
menu cards, the dish sheet and the admin product list. Change it there and it
changes everywhere. Saves keep one tag on every write path (admin data layer
and MCP: `normalizeTags`); a per-client exception would be a deliberate,
documented switch, not the default.

## Which tag wins

`primaryTag` picks the highest-ranked known tag:

1. Chef's special
2. Recommended
3. Spicy
4. Vegan
5. Vegetarian
6. Gluten-Free

If the dish has no known tag, its first free-text tag (as the restaurant typed
it) is shown.

## One colour per tag

Each known tag has its own colour (soft background, dark text), used the same
way in the menu, the dish sheet and the admin (where the selected tag button
takes its colour):

| Tag | Colour |
| --- | --- |
| Chef's special | purple |
| Recommended | sky blue |
| Spicy | red |
| Vegan | emerald |
| Vegetarian | green |
| Gluten-Free | amber |
| Free-text tags | neutral grey |

On the dark visual feed, the pill keeps its dark glass background and uses the
tag's light colour for the text.

## Adding a tag

1. Add it to `KNOWN_TAGS` in `src/lib/menu/dish-tags.ts` with a colour and its
   position in the priority order.
2. Add its translations to `TAG_COPY` in `src/components/menu/menu-i18n.ts`.
3. Offer it in the admin (`DEFAULT_TAGS` in `ProductsClient.tsx`) if owners
   should pick it.

Colours are fixed in code today. Letting each restaurant choose its own tag
colours would need a settings column and an admin screen; it is not built.
