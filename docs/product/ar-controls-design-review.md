# AR controls design review — proposal

Status: proposed for owner review on 2026-11-12. This document does not approve
or deploy a redesign. The runtime component is unchanged by this proposal;
the earlier uncommitted 44px control-height correction remains separate.

## Review

| Area | Current limitation | Proposed improvement |
| --- | --- | --- |
| Exit and header | Small icon-only exit competes with a variable-width size/reset group. | Keep close/help in fixed 44px corner targets, with stronger contrast. Reserve the centre for size status only. |
| Ordering | Dish name, action and price compete for one row and get truncated on narrow phones. | Owner revision 2026-11-12: dish name moves to the top centre, over the dish (incoming-call style). Bottom right holds the price capsule in the primary brand colour (contrast-picked text) and, for guest-ordering menus only, a round 44px + button. Other menu types show only the price. |
| Guidance | A long floating instruction block competes with the camera area. Percentage-based vertical positions vary with phone height. | Use short, state-specific guidance in a predictable bottom area; expand gesture help only on request. |
| Scale | The percentage and reset action crowd the header; a pill that looked like a button did nothing. | Scale moves to bottom left. At real size it is a plain label (ruler icon, no pill, so it does not look tappable). After resizing it becomes a button ("300% ↺") that restores real size; the separate restore button is gone. |
| Confirmation | A floating toast changes how much space the bottom stack occupies. | Each tap on + floats a short "+1", "+2" above the button and keeps a count badge on it, plus a screen-reader announcement. Nothing in the layout moves. With required options, + returns to option selection instead. |

## Surface feedback requested by the owner

The camera opens without a dish or ghost model. While scanning, give a quiet
instruction to move the phone slowly. A valid surface gets a small, subtle
patch of dots to indicate where placement is available. The dish appears
only after a deliberate tap on that region. Dots then disappear.

The local proposal illustrates that sequence; it does not perform WebXR
tracking. A runtime implementation must anchor feedback to valid hit-test
poses and clear it when tracking is lost. Do not paint a full table mesh or
claim geometry that was not actually detected. Prefer a short fade after a
stable hit and a minimal, reduced-motion-friendly local patch. Before the
placement tap, do not preload a visible dish into the scene.

## Constraints retained

- Follow the [shared customer-menu design contract](design-consistency.md):
  harmonize the price role, formatter, font family, button language and control
  sizing with cards, product detail, feed and other relevant customer views.
  The owner approved this cross-screen requirement, not every detail of this
  proposed AR layout.
- Browse-only menus and waiter-only ordering show dish information without
  any cart, add or choose-options action. The preview uses the real
  `resolveTenantCapabilities` resolver: only `guestOrdering` enables those
  actions. Availability of a connected payment account alone does not decide
  the layout. The current `MenuPage`, `ProductModal` and `MenuFeed` already
  pass no AR cart when guest ordering is unavailable; the proposal preserves
  that rule. Final owner refinement: the browse-only layout has the unwrapped
  dish name on the left and a coloured price capsule on the right, with no
  cart button, shared outer card or empty action placeholder.
- Regular controls remain 44px high; close/help remain 44×44px.
- Keep safe-area spacing on every side and leave the centre camera area free.
- Preserve browse-only menus and required-option behavior.
- Keep all proposal interactions local: no orders, payments, camera access,
  image generation or production writes.
- Use solid or sufficiently opaque surfaces for labels over unpredictable
  camera imagery; normal text needs a 4.5:1 contrast threshold under
  [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).
  [Apple button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons)
  also emphasizes consistent nearby button sizing and comfortable hit regions.

## Preview and validation

The existing local preview at `http://127.0.0.1:4188/` compares **Atual** and
**Proposta**. Its visible menu-type selector covers menu-only, waiter ordering
and customer ordering; the default is menu-only. It can simulate scanning,
surface found, placement, size changes, required options, multiple languages
and long names.
Proposal code lives only under the ignored `output/ar-ui-preview/` directory.
The actual component remains the source for the current-design comparison.

Validate narrow and short screens, complete action labels, visible close/help,
no dish before a placement tap, reset-to-real-size, help open/close, and
repeated add confirmations. Physical surface feedback must still be tested
on an actual Android device after a separately approved implementation.

## Review evidence

The three real capability modes were exercised in the preview: menu-only and
waiter-only rendered zero cart actions, while customer ordering rendered one.
The 15 service-mode tests passed. The optional showcase/contact test file could
not load because local `libphonenumber-js/core` is missing; this is an environment
limitation, not evidence that the suite passed. No runtime capability code was
changed. Browser checks covered surface-tap placement, repeated add confirmation
without card movement (98px before/after), help, 300% reset, Spanish labels,
long names, and narrow-screen controls remaining inside the frame at 44px high.
The owner subsequently refined the proposal to remove the shared price card:
larger name at left without a visual wrapper, coloured price capsule at right,
and optional add action below. A fixed bottom scrim supports readability over
the camera without boxing the name in; it remains screen-fixed when tracking
or the camera moves. Public Aurora branding was read without credentials:
`accent_color=#e94560`, `primary_color=#1a1a2e`. The prototype uses the existing
primary brand colour for the filled capsule and white foreground, following
the owner's correction and the existing filled controls. The previous pink
capsule with dark text was rejected. This sample colour must become a real
tenant prop in the implementation.
The 98px measurement describes the earlier prototype. The final unwrapped
layout was checked visually against a bright white camera-test backdrop with
a long name clamped to two lines: the fixed gradient covered both lines, the
name remained readable and the price capsule stayed separate at the right.
The owner subsequently rejected the added gradient layer as an unrequested
change. That extra layer has been removed; the original preview camera backdrop
is preserved. The bright-background check above describes the rejected layer,
not validation of the revised composition. Real-device validation remains open.

## Revision 2026-11-12 (owner)

- Dish-name shadow: tight and directional, down and to the right, lightly
  blurred, with moderate alpha: `text-shadow: 1px 2px 2px rgb(0 0 0 / 45%)`.
  This replaces both the earlier "no shadow" refinement and any spread or
  glow-like shadow. The same shadow is used on the other text drawn straight
  over the camera (real-size label, +N bubble).
- Layout, scale and confirmation as in the review table above.
- Real problems found in review and fixed in the preview: the inert scale
  pill that looked like a button; price and add action competing as two
  filled 44px blocks; white text hard-coded on any brand colour (now
  contrast-picked, testable via "Cor da marca"); the preview frame was 500px
  tall, so it is now 390×844 to match a real phone.
- Still open: real-device check over bright tablecloths, and a tenant
  `primary_color` prop in the runtime implementation.

## First-use gesture guidance

> Superseded on 2026-11-12: the three-step intro below (drag, rotate, pinch)
> was replaced by a tap-to-place animation and a once-per-browser "drag to
> move" hint after the first placement. See
> [ar-experience-plan.md](ar-experience-plan.md).

Owner requirement: show subtle animated fingers during the first AR setup only.
Remember the experience per browser, across dishes; do not use a product or
tenant key. End guidance when the dish is placed, the view closes, or the short
sequence completes. It must not capture touches or obstruct placement/closing.
Respect reduced-motion preferences. Preview replay controls are review tools,
not part of the customer experience. Clearing browser storage or changing
browser/device can make the guide appear again.

Implemented locally in `ArGestureOnboarding.tsx`, with a shared versioned
localStorage claim independent of dish/tenant, a nine-second three-gesture
sequence (drag, rotate, pinch), localized labels and a static reduced-motion
alternative. WebXrDishViewer mounts it only during active setup; automatic
post-placement coaching was removed and manual help remains. ArButton passes
the menu language. Native Scene Viewer/Quick Look own their overlays; this
component applies to the in-page WebXR viewer and the review preview.

Five targeted persistence tests and scoped ESLint passed. Browser checks
confirmed initial display, disappearance at placement and no repeat on return
to setup or full reload. The local preview now runs directly at its localhost
origin so storage persists, rather than inside the earlier opaque iframe.
Storage failure falls back to page memory (reload persistence then cannot be
guaranteed). No deployment or physical-device validation was performed.

Owner refinement: dish names in the AR proposal use plain white text without
text shadow. Only that shadow was removed; the rebuilt preview was checked
visually in the placed state and both existing side tabs were refreshed.
