# Augmented reality (3D dishes)

Guests open a dish, tap **View in 3D**, and the phone's camera opens with the
dish placed on their table at its real size, like a shop's "view in your
room". There is no 3D view in the page (owner decision, 2026-11-09): the only
point is seeing the portion on the table. Restaurants upload the model in the
dish editor (Media tab › *3D & augmented reality*).

This document covers the foundation that is in place and what is still open.

## How it works

| Device | Route | File used |
|---|---|---|
| Android | Google Scene Viewer through the Google app (`com.google.android.googlequicksearchbox` intent, `mode=ar_preferred`, `resizable=false` at real scale): AR camera when the phone supports it (Scene Viewer asks to install Google Play Services for AR if missing), the dish in 3D otherwise. Without the Google app the browser returns to the menu with `#ar-unavailable` and a notice shows. (An AR-only `com.google.ar.core` intent did nothing on a Galaxy S24 without that app, 2026-11-09.) | GLB |
| iPhone / iPad (Safari, any browser with `rel="ar"`) | AR Quick Look (`#allowsContentScaling=0` at real scale) | USDZ; an old model without one is converted on the phone first |
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

## Production setup

1. **Schema on the owned database.** Applied by the *Owned schema* workflow
   (`.github/workflows/owned-schema.yml`, see `docs/owned-schema/README.md`):
   run it with `mode=plan`, then `mode=apply` and `confirm_sha`. Do **not**
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
