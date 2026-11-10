# Augmented reality (3D dishes)

Guests open a dish, tap **See it on your table** (pt: **Ver na sua mesa**), and the phone's camera opens with the
dish placed on their table at its real size, like a shop's "view in your
room". There is no 3D view in the page (owner decision, 2026-11-09): the only
point is seeing the portion on the table. Restaurants upload the model in the
dish editor (Media tab › *3D & augmented reality*).

This document covers the foundation that is in place and what is still open.

## How it works

| Device | Route | File used |
|---|---|---|
| Android | Our WebXR viewer in the browser (`src/lib/ar/webxr-dish-session.ts`, three.js, UI in `src/components/ar/WebXrDishViewer.tsx`): the camera looks for a surface facing up first (nothing is shown while scanning), a ring and a see-through dish mark where it will go, a tap places it at real size (XR anchor when available). One finger drags it along the table, two fingers turn it and resize it (50–300 %, snapping to 100 %; chip shows "Real size" or the % with a button back). A gesture hint shows after placing (and from "?"). The order bar adds the dish to the cart without leaving the camera, or, for dishes with required choices, leaves it and points at the missing choice. Chrome asks once to allow the 3D map of the surroundings. Without WebXR AR: Scene Viewer intent through the Google app (`#ar-unavailable` notice without it). `<model-viewer>` placed the dish floating and only snapped its height to the first floor it saw, hence our own viewer (2026-11-10). | GLB |
| iPhone / iPad (Safari, any browser with `rel="ar"`) | AR Quick Look: finds the table itself, places the dish at real size, lets the guest resize it (shows the %, snaps back to 100 %). With a cart, Quick Look's own button (`#callToAction=…&checkoutTitle=…&checkoutSubtitle=…`, `message` event `_apple_ar_quicklook_button_tapped` on the `<a rel="ar">`) adds the dish, or leads back to its choices | USDZ (made at the dish's real size); an old model without one is converted on the phone first |
| Computer, iOS in-app browsers | no button | — |

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
| Back-office preview only | `src/components/ar/ModelViewer.tsx` (`@google/model-viewer`) |
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
