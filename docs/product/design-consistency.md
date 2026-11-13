# Customer menu design consistency

Owner-approved direction, 2026-11-12: prices, colours, typography, dimensions,
icons, buttons and spacing must form one coherent design across related
customer views. This is a mandatory rule for new and revised UI, not a claim
that the existing application has already been fully aligned.

## Scope

Apply to dish cards, list/grid and featured rows, visual feed, product detail,
AR controls and metadata, options/ingredients, cart, upsell and checkout where
those views exist. Include related sheets, notices and loading/empty/error
states. Do not create ordering UI for a menu that does not offer guest orders.

## Shared design contract

| Element | Required consistency |
| --- | --- |
| Prices | Use the same currency/locale formatter and pricing model as the menu. Preserve size-dependent “from” prices, promotions, modifiers and price multipliers. Distinguish unit prices, line totals and order totals; consistency must not make different quantities appear to be the same price. |
| Price colour | On light menu surfaces (cards, product detail) prices keep the configured secondary/accent role (`accent_color` / derived `accentText`). On AR/camera surfaces the owner chose a filled capsule in the primary brand colour (2026-11-12). Its text colour is chosen for contrast (white or near-black, whichever passes 4.5:1), never hard-coded white. |
| Type family | Use the existing Inter/menu font stack and locale fallbacks. Do not introduce Arial/system-only islands in a related product view. |
| Type hierarchy | Define shared roles for dish names, unit prices, totals, supporting text and action labels. Reuse size, weight, line-height and numeric treatment for the same role. Different roles may have a deliberate hierarchy; avoid per-screen arbitrary values. Keep currency figures tabular where appropriate. |
| Identity vs purchase | Keep identity and purchase styling distinct. AR layout (owner, 2026-11-12): dish name centred near the top, over the dish, like a caller's name on a phone call; scale status at bottom left; price capsule and, only with guest ordering, a round 44px add (+) button at bottom right. Filled brand fills use contrast-picked text. No camera gradient or scrim (the owner rejected it); readability comes from a tight down-right text shadow on text drawn directly over the camera. Browse-only menus have no empty purchase wrapper. |
| Buttons | Reuse primary/secondary/quiet variants, radius, padding, label weight, icons and pressed/loading/disabled feedback. Related AR controls are 44px high and close/help are 44×44px; treat inconsistent 48/52px counterparts as explicit rollout gaps, not new defaults. Agree any distinct primary-action size as a shared variant rather than a one-off override. |
| Colour roles | Keep the restaurant's primary action and secondary/accent roles coherent. Camera overlays may use a contrast-safe surface variant; this is an adaptation of the shared system, not an independent palette. |
| Icons | Use the same icon family, stroke and size for equivalent actions, and the same touch target rules. Keep visible glyph size separate from hit-region size. |
| Layout | Reuse spacing and corner-radius scales, safe-area treatment and sheet patterns. Do not truncate essential action labels to make an inconsistent layout fit. |
| Feedback | Align success, warning, validation, loading and disabled states across views. Do not move the main action when confirming an addition. |

Readable contrast takes precedence over literal colour duplication. Check
labels on both light menu surfaces and unpredictable camera backgrounds;
normal text follows the 4.5:1 threshold described by
[WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).
Shared semantics and role-based hierarchy take precedence over making every
piece of text or every container mechanically identical.

## Capability-aware layouts

Use `resolveTenantCapabilities` and its `guestOrdering` result as the shared
authority. Menu-only and waiter-only plans keep customer AR read-only; show
dish information without cart or choose-options controls. Customer ordering
also requires the relevant restaurant switches. A connected payment account
by itself is not the authority for showing an action. Preserve this rule in
cards, feed, details, AR, cart, chat and checkout.

## Evidence and rollout gaps

The review found existing Inter/menu typography and shared `formatMoney`,
card/detail accent price colours, AR controls at 44px locally, product-detail
primary actions at 52px, and some checkout actions at 48px. The AR prototype
previously used isolated font/price examples; it is being aligned to the real
font and money formatter as part of the proposal. No broad runtime restyle
has been completed by this document.

Before implementation, compare the related screens together and choose
shared tokens/components. Roll out changes to equivalent roles together;
check long names, translated labels, large prices and every menu type. Verify
that price values, permissions and ordering behavior have not changed. Record
remaining inconsistencies and validation in the Journal. Production release
still follows the owner's existing authorization rules.

The current AR proposal is documented in [the AR controls review](ar-controls-design-review.md).

## Sheets (owner, 2026-11-12) — applies to the whole app

Every panel that slides up over a screen (product detail, cart, AR order and
details sheets, notices, pickers) behaves like an iOS sheet:

- a visible grabber (36×5px pill) at the top;
- drag down to dismiss, with a quick downward fling also dismissing; a short
  drag snaps back;
- drag up to expand to a large detent; resistance (rubber band) past the top;
- the scrim fades with the drag, and tapping it closes the sheet;
- content scrolls inside the sheet without dragging the sheet itself.

Implementations (checked 2026-11-12):

- `src/components/ui/BottomSheet.tsx`: the standard for menu sheets (cart,
  checkout, "complete your order"), with medium/large detents.
- `src/components/ui/use-drag-to-dismiss`: the dish sheet (`ProductModal`) and
  the feed size picker (`FeedSizeSheet`); both show the 36×5 grabber.
- `src/components/sheet/DragSheet.tsx`: only inside the AR camera, because the
  WebXR DOM overlay shows only what renders inside its root (no portals).

New sheets use `BottomSheet` (or `DragSheet` inside the AR overlay); no other
sliding panel shapes.

## Quantity control

Adding a dish: `+` turns straight into the white `− qty +` stepper; each tap
updates the number in place and the cart badge counts up. No floating "+1"
bubble and no intermediate check mark (owner, 2026-11-12: too much motion
for one action). Reaching zero returns to `+`. In AR it keeps the 44px dock
height. The menu card still shows a 700 ms check before its stepper; align it
with this rule when the card is next revised.

## Badges and buttons on dark surfaces

Notification badges (for example the cart count) use the store's secondary
colour (`accent_color`) with contrast-picked text and no dark ring, so they
read as notifications against primary-coloured fills. On dark AR sheets, a
primary-coloured button whose brand colour is too dark to see uses the
store's secondary colour instead (owner choice, 2026-11-12).

## Visual tokens: the feed is the reference (owner, 2026-11-12)

The visual feed's look is the reference for every customer surface. Type and
button shapes come from one file, `src/components/menu/menu-ui.ts`:

- `ui.dishTitle` — dish names (heavy, tight); `ui.sheetTitle` / `ui.barTitle`
  for sheet and header titles;
- `ui.label` — the small uppercase, widely tracked label ("Ingredients",
  "Size", "Subtotal", "02 / 05");
- `ui.price` — prices and totals;
- `ui.cta` + `ctaStyle(colour, foreground)` — the primary action as a full
  pill, uppercase, with the store colour's soft glow (h-12 in the menu, h-11
  in the AR camera); `ui.ctaQuiet` for quiet secondary actions.

Used by the feed, the dish sheet, the cart, checkout, "complete your order",
the feed size picker and the AR camera's sheets. Colours stay per surface
(light sheets, dark camera). Change a token and every screen follows; do not
restyle one surface locally. The feature pill is `DishFeaturePill`
(docs/product/dish-tags.md).

**Dish name and price: `DishHeading`** (`src/components/menu/DishHeading.tsx`).
Every surface that shows a dish uses it: name on the left, price on the right
on the same row, in `ui.dishTitle` / `ui.price` at the sizes in
`ui.dishHeading` (`feed` over the photo, `sheet` on the dish screen and the 3D
camera's details sheet). The price never goes inside a button: the add button
reads just "Add to order". `ui.sheetTitle` is only for titles that are not a
dish ("Your order", "Cart").

