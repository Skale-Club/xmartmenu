# AR dish experience — implementation plan

Status: proposed for owner approval, 2026-11-12. Nothing here is implemented in
the app yet. Every UI decision below was reviewed by the owner in the local
preview (`output/ar-ui-preview/`, git-ignored; `Proposal.tsx` is the reference
implementation, served by the `ar-ui-preview` entry in `.claude/launch.json`).
Related: [design consistency contract](design-consistency.md),
[AR controls design review](ar-controls-design-review.md).

Scope: the in-browser WebXR viewer (Android Chrome:
`src/lib/ar/webxr-dish-session.ts`, `src/components/ar/WebXrDishViewer.tsx`,
`src/components/ar/ArButton.tsx`) plus the size settings passed to the native
viewers (Scene Viewer on Android, AR Quick Look on iPhone), which draw their
own UI and cannot show ours.

## 1. Zoom — final recommendation: no resizing, real size only

The reason to show a dish in AR is to answer "how big is this portion?". A
dish blown up to 300% shows food that will not arrive at the table, undermines
the real-size promise and can look like the restaurant exaggerates its
portions. To see detail, the guest moves the phone closer — AR's natural zoom.

| Viewer | Today | Change |
| --- | --- | --- |
| WebXR (ours) | pinch 50–300%, snaps to 100%, `MAX_DISH_SCALE = 3` | Remove pinch-to-scale. Two fingers only rotate. The dish always renders at its real size. |
| Scene Viewer | `resizable=false` when `real_scale` is set | Keep. |
| AR Quick Look | guest may resize; Quick Look shows % and snaps to 100% | Add `allowsContentScaling=0` to the USDZ fragment in `quickLookUrl` when `real_scale` is set. **Verify on an iPhone** before relying on it. |

UI consequences:

- The zoom pill goes away. A permanent "Reposition" button was tried and
  dropped by the owner (2026-11-12): dragging moves the dish; when the table is
  lost, the notice carries a "Try again" button that returns to the dots.
- No "real size" notice: the owner found it obvious (2026-11-12).
- Removed: zoom pill, restore button, `Max` limit feedback, percent/multiplier
  label, `onScale` / `resetScale` plumbing.
- If a model has no calibrated real size (`real_scale` false), the dish still
  shows at its file size, and the notice reads "approximate size" instead of
  promising real size.

Code: `src/lib/ar/gestures.ts` (drop `pinchScale`, `MIN/MAX_DISH_SCALE`, scale
snapping; keep `twistYaw`), `webxr-dish-session.ts` (two-finger handler rotates
only; remove scale animation and `resetScale`), `WebXrDishViewer.tsx` and
`ArButton.tsx` (remove scale state), `src/lib/ar/launch.ts`
(Quick Look fragment). Update `tests/unit/ar/gestures.test.ts` and
`webxr-dish-session.test.ts`.

## 2. Surface finder — minimal dots that reflect the real table

Today: one hit-test ray from the screen centre, accepted when the surface is
roughly horizontal; a white ring plus a 40% "ghost" dish; no smoothing, no
debounce, no hints, no handling of lost tracking. The dots seen in the preview
are CSS only. Maturity: detection 5/10, visuals 4/10, device validation 2/10.

Target behaviour:

1. **Several rays.** 9–16 hit-test sources from the viewer space with small
   `offsetRay` angles around the centre. A dot is drawn only where a ray hits
   a surface at the same height (±1.5 cm) and facing up like the centre hit,
   so the patch shows the table area actually detected. Never paint a surface
   that was not hit.
2. **Stable, not flickering.** Show the patch after ~200 ms of consistent hits;
   hide it only after several consecutive misses (hysteresis). Smooth the patch
   pose between frames; short fade in/out; no motion under
   `prefers-reduced-motion`.
3. **No ring, no ghost dish.** Only the dots. Tap places the dish; dots fade out.
4. **Hints over time.** After ~8 s without a surface: one short hint at a time
   ("Point at the table", "Move the phone slowly", "Try more light").
5. **Tracking lost after placing.** When the anchor pose is missing for a while:
   discreet notice with a "Try again" button (back to the dots).
6. **Loading first.** Placement is disabled until the model is ready (see 4).

Code: `webxr-dish-session.ts` (hit sources, dot instancing with one
`InstancedMesh`, stability state machine, lost-tracking signal to the UI),
`WebXrDishViewer.tsx` (hints, lost notice). Tests: unit tests for the
stability state machine and the coplanar-dot filter (pure functions in
`src/lib/ar/`), plus the existing session tests.

## 3. Screen layout (approved in the preview)

- **Top bar:** close (X, 44px) left; right: cart bag (only with guest ordering
  and items) and details **i** (plain "i" glyph inside the round 44px button).
  The ? help button is removed; gesture help is the first-time hints only.
- **Dish name:** centred under the top bar, incoming-call style, 24px/600,
  white with `text-shadow: 1px 2px 2px rgb(0 0 0 / 45%)`. Tapping the name
  also opens the details.
- **Dish carousel:** swipe on the name strip or tap the side chevrons (a
  one-finger drag elsewhere moves the dish). Morse-style position indicator:
  at most five marks, current dish as the centred dash, dots fade and shrink
  with distance, track slides one slot per change. One dish: no chevrons, no
  indicator.
- **Bottom dock (44px, full pill radius, 15px/600 labels), on the right:** price capsule in the primary brand colour with contrast-picked text
  (promotions show the old price struck through, sized dishes show "From"), and
  with guest ordering a white `+` that turns straight into `− qty +`. No
  floating "+1", no check step. Menu-only and waiter-only menus show the price
  only.
- **Cart:** bag icon with a count badge in the store's secondary colour
  (`accent_color`), soft shadow, no ring. Opens the order sheet (items, line
  totals, total, "Go to cart" leaves AR to the menu cart, "Keep browsing").
- **Details sheet (owner, 2026-11-12):** `DishHeading` on top (name left,
  price right on the name's last line; the name wraps past 60% of the width),
  the description and a "More info" link that leaves the camera and opens the
  dish's own screen. With guest ordering, an order row: "Add to order" (no
  price inside) that turns into the "In your order" row with the line total and
  the `− qty +` stepper, and the cart bag with its badge beside it whenever the
  order has anything (including what was added before opening the camera).
  No ingredients, no "How to use", no "Back" button (the sheet closes with the
  grabber or a tap outside; the X at the top leaves the camera). No allergens
  section (the system has no allergen field).
- **Sheets everywhere:** iOS-style — grabber, drag down to dismiss, drag up to
  expand, rubber band, scrim fades with the drag (rule recorded in the design
  contract for the whole app).
- **Primary buttons on dark sheets:** if the primary brand colour is too dark
  to see, use the secondary colour.

### Gesture hints (owner, 2026-11-12) — done with package 1

Only two animations, drawn with a minimal white touch dot (owner chose it over
hand icons): (1) the dot pressing with a ripple and "Tap to place" whenever a
surface is found, gone with the tap; (2) the dot sliding sideways with "Drag to move"
right after the dish first lands, once per browser
(`xmartmenu:ar-move-hint:v2`), never again for another dish or visit. The size
notice follows it. No twist or pinch animation. Hint texts are generic (no
"dish"): the item may be a drink or a dessert.

## 4. Loading and neighbour preloading

- A glass card where the dish will appear: "Loading 3D dish", percentage,
  thin progress bar with a moving sheen, "Just a moment".
- Real progress from the GLB download (`fetch` + `ReadableStream`
  content-length), not a timer. Unknown length: indeterminate bar.
- The dish on screen downloads first; the previous and next dishes preload in
  parallel at lower priority; finished models stay cached (`preloadDish`
  cache). Swiping to a preloaded dish shows it at once at the same anchor.
- Respect `navigator.connection.saveData`: no neighbour preloading.

## 5. Data needed from the menu

The viewer receives the ordered list of AR-enabled dishes of the menu (name,
GLB/USDZ, real-size flag, unit price with promotion/from data, description,
ingredients, required options flag), the brand colours (`primary_color`,
`accent_color`) and the cart actions. Capabilities come only from
`resolveTenantCapabilities` (`guestOrdering`). Required options: `+` returns to
option selection instead of adding.

## 6. Gesture zoning — one region, one job (owner, 2026-11-12)

Many fingers do many things on one screen: tap to place, drag the dish, twist
it, swipe to the next dish, tap the name, drag sheets, scroll inside them, plus
the phone's own back and home gestures. Mixing them would move the dish when
the guest meant to change dish, or close a sheet when they meant to scroll.
Rule: **the screen is split into fixed regions, each region owns a short list
of gestures, and the region where the first finger lands owns the whole
gesture until every finger lifts.** Nothing is handed over mid-gesture.

```
┌───────────────────────────────┐
│ ① Top bar        X   🛍  i    │  buttons only (taps)
├───────────────────────────────┤
│ ② Name strip  ‹ Picanha ›     │  swipe ←/→ = change dish · tap = details
│               • ━ •           │  (indicator is display only)
├───────────────────────────────┤
│                               │
│ ③ Scene (camera + dish)       │  before placing: tap = place
│                               │  after: drag ON the dish = move
│                               │         two fingers = rotate
│                               │  never: change dish, open sheets, resize
├───────────────────────────────┤
│ ④ Dock              $29  − 2 + │  buttons only (taps)
└───────────────────────────────┘
  ⑤ Sheets (cart, details): when open they own every touch;
     the scene underneath gets nothing.
  ⑥ Side and bottom edges (≈24 px): left to the phone (back / home gestures).
```

| Region | Allowed | Ignored on purpose |
| --- | --- | --- |
| ① Top bar | tap on X, cart, i | swipes, drags, two fingers |
| ② Name strip | horizontal swipe (dish change), tap (details), chevron taps | vertical drags, two fingers, swipes that start in the edge zone |
| ③ Scene, scanning/surface | tap to place (only when a surface is found and the model is loaded) | everything else |
| ③ Scene, placed | one-finger drag that **starts on the dish** (screen footprint + 48 px tolerance) moves it; two-finger twist rotates it | drag that starts away from the dish, taps, pinch distance, horizontal swipes (never change dish here) |
| ④ Dock | taps on price, `−`, `+` | swipes, drags |
| ⑤ Sheet open | grabber/header drag (close / expand), body scroll, taps on its buttons | anything reaching the scene, horizontal swipes |
| ⑥ Edges | nothing of ours | — |

Thresholds (one place, tuned on devices):

- **Tap:** moves < 10 px and lasts < 300 ms.
- **Dish swipe:** ≥ 48 px horizontally, with |dx| > 1.5·|dy|; direction locks
  after 10 px; must start ≥ 24 px from the side edges.
- **Dish drag:** starts on the dish; follows the finger after 8 px.
- **Twist:** two fingers in the scene; rotation starts after 4° to avoid jitter;
  finger distance is ignored (no resize).
- **Cool-downs:** 300 ms after a dish change or a placement, scene taps and
  drags are ignored, so a fast double action cannot place twice or move the
  dish by accident.
- **Feedback:** light haptic tick (Android `navigator.vibrate`) on placement
  and dish change; the dish lifts subtly while grabbed; the name slides on a
  dish change.

How it is built:

- A pure router, `src/lib/ar/gesture-router.ts`: input = region of the first
  touch + pointer samples; output = one intent (`tap-place`, `move-dish`,
  `rotate-dish`, `next-dish`, `prev-dish`, `open-details`, `none`). Regions come
  from `data-ar-region` attributes on the overlay elements. The WebXR session
  only executes intents; it no longer reads raw touches for decisions.
- Table-driven unit tests for every row above (including edge-start swipes,
  drags that start off the dish, a second finger landing in another region,
  taps during cool-down, gestures while a sheet is open).
- A device test script (Android Chrome and iPhone) with the same scenarios,
  run before each AR merge.

## 7. Delivery order

| # | Work package | Depends on | Notes |
| --- | --- | --- | --- |
| 1 | Real size only (section 1) | — | Done locally 2026-11-12 (uncommitted), with the two gesture hints. |
| 2 | Surface finder (section 2) | — | Done locally 2026-11-12 (uncommitted): 13 rays, dots, hysteresis, smoothing, tips, lost table. Needs a phone to tune. |
| 3 | Layout, dock, cart sheet, details sheet (section 3) | 1 | Done locally 2026-11-12 (uncommitted). |
| 3b | Gesture zoning and router (section 6) | 3 | Done locally 2026-11-12 (uncommitted). |
| 4 | Carousel, loading, preloading (sections 4–5) | 3b | Done locally 2026-11-12 (uncommitted). |
| 5 | Sheet rule across the app | — | Checked 2026-11-12: menu sheets already iOS-style (BottomSheet / drag-to-dismiss); feed size grabber aligned. |

Each package: own branch from `dev`, targeted unit tests, then a mandatory
check on a real Android phone (Chrome, WebXR) and an iPhone (Quick Look size
lock, order button) before merging to `dev`. Heavy steps (full build, e2e)
run on the desktop or in CI, not on the Surface.

## 8. Open points

- Confirm `allowsContentScaling=0` on a current iPhone.
- Translate demo strings and confirm wording in pt/en/es.
- Decide whether the menu card adopts the same "+ → stepper" without the
  700 ms check (recorded as a rollout gap in the design contract).
- Hit-test with many rays: measure frame time on a low-end Android.
- Tune gesture thresholds and the dish-grab tolerance on real phones.

## Which iPhone browsers show 3D (owner, 2026-11-12)

The 3D icons and buttons appear only where the phone can open the dish in AR.
On iPhone that is Safari (`relList.supports('ar')`) and the browsers built on
Apple's web view that open AR Quick Look even though that check reports false:
Chrome (`CriOS`), Edge (`EdgiOS`), Firefox (`FxiOS`), the Google app (`GSA`)
and DuckDuckGo, the same list Google's `<model-viewer>` uses
(`arPlatform` in `src/lib/ar/launch.ts`). Other in-app browsers (Telegram,
Instagram, Facebook) cannot open Quick Look, so no 3D shows there. The owner
accepted that: no "open in Safari" notice.
