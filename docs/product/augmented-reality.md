# Augmented reality (3D dishes)

Guests open a dish, tap **See it on your table** (pt: **Ver na sua mesa**), and the phone's camera opens with the
dish placed on their table at its real size, like a shop's "view in your
room". On phones there is no 3D view in the page (owner decision, 2026-11-09):
the only point is seeing the portion on the table. Computers, which have no AR
camera, show the dish in a 3D viewer in the page instead (2026-11-12). Restaurants upload the model in the
dish editor (Media tab › *3D & augmented reality*).

This document covers the foundation that is in place and what is still open.

## How it works

| Device | Route | File used |
|---|---|---|
| Android | Our WebXR viewer in the browser (`src/lib/ar/webxr-dish-session.ts`, three.js, UI in `src/components/ar/WebXrDishViewer.tsx`): the camera looks for a surface facing up first (nothing is shown while scanning), a ring and a see-through dish mark where it will go, a tap places it at real size (XR anchor when available). One finger drags it along the table, two fingers turn it and resize it (50–300 %, snapping to 100 %; chip shows "Real size" or the % with a button back). A gesture hint shows after placing (and from "?"). The order bar adds the dish to the cart without leaving the camera, or, for dishes with required choices, leaves it and points at the missing choice. Chrome asks once to allow the 3D map of the surroundings. Without WebXR AR: Scene Viewer intent through the Google app (`#ar-unavailable` notice without it). `<model-viewer>` placed the dish floating and only snapped its height to the first floor it saw, hence our own viewer (2026-11-10). | GLB |
| iPhone / iPad (Safari, any browser with `rel="ar"`) | AR Quick Look: finds the table itself, places the dish at real size, lets the guest resize it (shows the %, snaps back to 100 %). With a cart, Quick Look's own button (`#callToAction=…&checkoutTitle=…&checkoutSubtitle=…`, `message` event `_apple_ar_quicklook_button_tapped` on the `<a rel="ar">`) adds the dish, or leads back to its choices | USDZ (made at the dish's real size); an old model without one is converted on the phone first |
| Computer | No AR camera, so the dish sheet shows **View in 3D** (pt: **Ver em 3D**) instead: the photo is swapped for the model in `<model-viewer>` (turn with the mouse, zoom with the wheel, slow auto-rotate, camera from above). **Back to photo** brings the photo back; the next dish opens on its photo. The library loads only on that click. Dish cards show the cube too. Owner decision 2026-11-12: an in-page 3D view on computers only; phones keep going straight to AR. `isComputer` in `launch.ts` (no iPhone/iPad/Android/"Mobile" user agent, not an iPad posing as a Mac). | GLB |
| iOS in-app browsers | no button | — |

`src/lib/ar/launch.ts` picks the route and builds the URLs (pure, tested);
`src/components/ar/ArButton.tsx` is the button. Nothing heavy loads for
guests: three.js is imported only on an iPhone whose model lacks a USDZ.

Scene Viewer cannot read Draco, meshopt or KTX2/WebP/AVIF textures and refuses
files over 15 MB, so uploads with those are refused (`model-file.ts`). The
back office makes the USDZ from the GLB in the browser right after upload
(`src/lib/ar/usdz-export.ts`, three.js `USDZExporter`, 1024 px textures). That
file is text USD with PNG textures, so a 90k-triangle scan comes out ~10 MB;
a binary (usdc) repack with JPEG textures is ~3 MB (see follow-ups).

## Pieces

| Layer | File |
|---|---|
| Schema, production (owned PostgreSQL) | `docs/owned-schema/20261107090000_product_ar_models.sql` |
| Schema, legacy Supabase | `supabase/migrations/20261107090000_product_ar_models.sql` |
| Types | `ProductArModel`, `PublicProductArModel` in `src/types/database.ts` |
| File checks (GLB magic/version/length, Scene Viewer-unsupported extensions, USDZ zip, 15 MB cap, 5 MB warning) | `src/lib/ar/model-file.ts` |
| Upload API | `POST /api/admin/products/upload-ar-model` (multipart `file`, `format=glb\|usdz`) |
| Back-office reads/writes, owned DB | entity `ar` of `POST /api/admin/products/[id]/catalog` (`src/lib/data/admin-product-ar.ts`) |
| Back office UI | `src/app/(admin)/menu/products/[id]/ProductArTab.tsx` (owned API, or Supabase in legacy mode) |
| Guest button and AR launch | `src/components/ar/ArButton.tsx`, `ar-copy.ts` (15 languages), `src/lib/ar/launch.ts` |
| iOS file from the GLB | `src/lib/ar/usdz-export.ts` (back office on upload; phone fallback) |
| 3D viewer: back-office preview, and the dish sheet on computers | `src/components/ar/ModelViewer.tsx` (`@google/model-viewer`, loaded on demand); `ProductModal` (`useIsComputer`, `view3d`/`viewPhoto`/`turnHint` in `ar-copy.ts`, 15 languages) |
| Public menu | `productArModelByProductId`: owned loader `src/lib/data/public-menu.ts`, legacy loader `src/lib/menu/public-menu-data.ts` → `MenuPage` → `ProductModal` |
| Analytics | `model_viewer_opened` (button tapped), `ar_launched` (AR viewer opened); client events, `source: 'detail'` |
| Headers | `Permissions-Policy: xr-spatial-tracking=(self)` in `next.config.ts` |
| Tests | `tests/unit/ar/*`, `tests/unit/public-menu-postgres.test.ts`, `tests/unit/menu/public-menu-cache.test.ts` |

### Data model

`product_ar_models` holds one row per dish (`product_id` is unique):
`glb_url` (required), optional `usdz_url`, `poster_url`, `real_scale` (AR at
the modelled size), storage keys and byte sizes. A trigger rejects a row whose
`tenant_id` is not the dish's tenant. On the owned database only the server
role `xmartmenu_runtime` reads and writes it; the catalog API checks the
tenant, the manager role and the request origin. The public menu selects only
`product_id, glb_url, usdz_url, poster_url, real_scale`.

The code ships before the schema: the owned public menu probes whether the
table exists and is readable inside its snapshot before reading it (an error
there would abort the whole menu), the back office lists no model and refuses
writes with a clear message, and the legacy loader ignores the query error.
No dish can have a model before the schema step, so no `ar_launched` event can
reach `menu_events` before its CHECK allows it (the same SQL does both).

## Real size

A model is shown at the size it was modelled (glTF metres). The back office
measures it (`glbFootprint`, `src/lib/ar/model-file.ts`: POSITION bounds
through the node transforms) and the restaurant types the dish's real
largest side in cm; `scale = real / modelled` is saved on
`product_ar_models` (with `model_width_cm`). The Android viewer multiplies
the model by it; the iOS file is regenerated at that size
(`glbToUsdz(glb, { scale })`). Example: the Aurora sandwich file measures
35.5 × 28.4 cm.

Scale corrections also apply on the Scene Viewer fallback: for `scale != 1`,
the button points at `/api/ar/scaled-model`, which wraps each GLB scene in a
scaled root node. Geometry, textures and binary buffers are copied unchanged;
no guest-triggered texture conversion or mesh processing occurs. Already
baked models (`scale = 1`) continue to use their CDN URL directly. The route
only reads AR objects from the configured public product-image bucket,
rejects redirects, limits input/output to 15 MiB and scene JSON to 1 MiB,
times out after 10 seconds, and permits one active request per process with
no queue. Shared rate limits cap each IP at 30/minute and all clients at
60/minute; successful responses permit CDN/browser caching for one day.
Errors are not cached, and no uncorrected model is substituted on failure.

Saving a corrected size is atomic with the matching iOS artifact: if USDZ
generation or upload fails, neither the scale nor the current USDZ fields
are changed. The restaurant sees an error and can retry. This prevents
Android and iPhone from showing different physical portions.

WebXR registers session cleanup as soon as the camera session is acquired.
Closing the dish or leaving AR cancels pending startup too. Failed startup
ends the camera session and disposes private renderer resources, while shared
preloaded model assets remain reusable. A nonhorizontal current hit clears
the previous table candidate. Anchor generations discard obsolete asynchronous
results after dragging, replacing or ending a session.

Regression check: `node --max-old-space-size=160 node_modules/vitest/vitest.mjs run tests/unit/ar --pool=threads --maxWorkers=1 --minWorkers=1 --no-file-parallelism`.
On the Surface (2026-11-12), the 98 targeted tests passed in about 4 seconds;
strict TypeScript checking of `src/lib/ar` took about 3 seconds and scoped
ESLint took about 8 seconds. Real-device camera/placement checks remain a
separate release validation; these mocked tests do not emulate AR tracking.

AR orders are recorded as `add_to_cart` with `source: 'ar'`.

## Production setup

1. **Schema on the owned database.** Applied by the *Owned schema* workflow
   (`.github/workflows/owned-schema.yml`, see `docs/owned-schema/README.md`):
   run it with `mode=plan`, then `mode=apply` and `confirm_sha`. Files:
   `20261107090000_product_ar_models.sql` (table) and
   `20261111090000_ar_real_size_and_cart_source.sql` (`scale`,
   `model_width_cm`, `'ar'` analytics source). The app reads the new columns
   only once they exist; until the second file runs, `source: 'ar'` events
   are refused by the CHECK, so apply it right after the deploy. Do **not**
   run `npm run db:migrate`: `.env.local` still points at the frozen Supabase.
2. **CORS on the R2 bucket `xmartmenu-product-images`** — done 2026-11-08
   (Cloudflare dashboard › R2 › bucket › Settings › CORS policy).
   `<model-viewer>` downloads the GLB with `fetch`, so reads need
   `Access-Control-Allow-Origin`; restaurants also use custom domains:

   ```json
   [{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
   ```

3. Test on a real Android phone and a real iPhone (AR cannot be emulated).

## Model guidelines for restaurants

- glTF Binary (`.glb`), glTF 2.0, units in **metres** at the dish's real size
  (a 26 cm plate is 0.26 wide) so "real size" AR shows the true portion.
- What Android's Scene Viewer accepts: no Draco/meshopt geometry compression,
  JPEG or PNG textures (no KTX2/WebP/AVIF), up to ~100k triangles, textures up
  to 2048 px, under 15 MB (aim for under 5 MB). From a heavy scan:

  ```bash
  npx @gltf-transform/cli optimize in.glb a.glb --compress false --texture-compress false --simplify-ratio 0.2
  npx @gltf-transform/cli resize a.glb b.glb --width 2048 --height 2048
  npx @gltf-transform/cli jpeg b.glb out.glb --quality 85
  ```

  (A 32 MB Sketchfab scan became 2.8 MB / 90k triangles this way.)
- Origin at the bottom centre of the plate, so it sits on the table.
- Photogrammetry apps (Polycam, Luma, RealityScan) export usable GLBs from a
  phone scan of the real dish.

## Generating models (Rodin + Blender)

Showcase dishes (Aurora, since 2026-11-12) are made from their menu photo,
with Blender in the middle so anything can be fixed by hand:

0. **Pick only dishes guests can see**: before spending credits, check the
   product is `is_available` in production and shows on the public menu. A
   hidden product's model is attached but nobody sees it (Celes "Classic",
   2026-11-13, had to be switched on after the fact).
1. **Generate** with Hyper3D Rodin Gen-2.5 (`Gen-2.5-High`, `Raw`,
   ~80k triangles, GLB, PBR). The owner's account is on the Creator plan,
   which has no REST API (`API_NO_ACTIVE_SUBSCRIPTION`), so generation goes
   through the Hyper3D connector (MCP, OAuth, `https://api.hyper3d.com/api/mcp`):
   `rodin_create_uploads` + HTTP PUT of the photo, `rodin_generate`,
   `rodin_wait`, `rodin_get_result` (download `base_basic_pbr.glb`). On a
   Business plan, `scripts/ar/rodin-generate.mjs` does the same with
   `RODIN_API_KEY`. A short prompt saying "only the plate and the food; no
   napkin…" keeps props out. Rodin tends to drop a dark plate and makes glass
   opaque.
2. **Prepare**: `node scripts/ar/dish.mjs prepare <tenant> <dish>` runs
   Blender headless (`scripts/ar/prepare-dish-model.py`) with the dish's size
   from `scripts/ar/dishes/<tenant>.json`. Standard sizes: main course on a
   30 cm plate, starter 23 cm, dessert 21 cm (food at its real portion),
   drinks by height; the owner changes any dish there. The first run scales
   the food, draws the plate (lathed stoneware, foot ring, near-black glossy
   speckled glaze; `--replace-plate` swaps an old one) and saves an editable
   `.blend`; later runs only resize that `.blend`, keeping manual edits.
   `--food-contrast/--food-saturation/--food-sharpen` grade the food texture,
   always from the original kept in the `.blend` (`<image>__orig`).
3. **Review (required)**: the `.blend` is opened in the Blender window
   (launched via WMI, framed in Material Preview through the Blender MCP)
   and the owner approves it or asks for changes before anything is
   published. Edits are exported again with `--from-blend`. The real size is
   baked in, so the row uses `scale = 1` and `model_width_cm` = the file's
   largest side.
4. **Publish**: `node scripts/ar/dish.mjs publish <tenant> <dish>` checks the
   files with `checkArModelFile`, uploads them to R2
   (`scripts/ar/upload-dish-model.ts`) and upserts the `product_ar_models`
   row in the owned database inside the app container (product by name,
   tenant check, advisory lock `xmartmenu-admin-menus:<tenant>`, one
   transaction). The public menu shows it within 60 s.

Special cases:

- **Drinks in glass are built from scratch**, not generated: Rodin fuses
  glass, ice and garnish into one frosted shell that cannot be made clear.
  `scripts/ar/build-drink.py` (Blender) lathes a clear glass and adds the
  liquid, translucent ice cubes, lime wedges and mint leaves as separate
  parts with their own materials, sized from the menu photo (the Mojito:
  15 cm highball, ~10k triangles, ~0.2 MB GLB). Transparency is glTF alpha
  blend: AR shows it with highlights but no refraction.
- **Scanned serving boards** with ragged sides are rebuilt with
  `scripts/ar/rebuild-board.py` (clean board of the same outline, the scan's
  wood baked on, `board-sides.py` for the sides; options for a handle hole,
  patches, plain zones and touch-ups).

Working files (raw GLB, `.blend`, exports, previews) are kept outside the
repo in the owner's Drive, `AR_MODELS_DIR` in `.env.local`
(`My Drive/Dev/xmartmenu/ar-models/<tenant>/{raw,blend,out}`).

## Open follow-ups

- **Plan gating**: AR is shown whenever a dish has a model. If it becomes a
  paid feature, add a plan feature key next to `orders`/`payments`.
- **Storage cleanup**: replaced/removed files stay in the bucket; the
  `*_storage_path` columns are there for a cleanup job.
- **Model pipeline**: server-side optimisation on upload (gltf-transform:
  simplify, resize, JPEG, so restaurants can upload any scan) and a binary USDZ
  (usdc + JPEG, ~3× smaller than the browser export; `usd-core`'s
  `UsdUtils.CreateNewARKitUsdzPackage` does it); AI or photogrammetry
  generation from dish photos.
- **Feed entry point**: a 3D badge on dish cards in the grid and the visual
  feed (today the entry is the dish detail only).
- **Dashboard**: the two events are recorded but not yet shown in the menu
  analytics dashboard.
