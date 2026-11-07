# Augmented reality (3D dishes)

Guests open a dish, tap **View in 3D**, turn the model around, and on a
supported phone tap **View on your table** to place the dish at its real size
through the camera. Restaurants upload the model in the dish editor
(Media tab › *3D & augmented reality*).

This document covers the foundation that is in place and what is still open.

## How it works

| Device | Route | File used |
|---|---|---|
| Android (Chrome) | WebXR in the page, else Scene Viewer (Google app) | GLB |
| iOS (Safari) | AR Quick Look | USDZ if uploaded, else converted from the GLB on the device |
| Desktop | 3D only, with "open on your phone" hint | GLB |

Built on Google's [`<model-viewer>`](https://modelviewer.dev)
(`@google/model-viewer` 4.4, with three.js). It is imported only when a guest
opens the 3D view, so menus without models never download it.

## Pieces

| Layer | File |
|---|---|
| Table, RLS, audit trigger, analytics events | `supabase/migrations/20261107090000_product_ar_models.sql` |
| Types | `ProductArModel`, `PublicProductArModel` in `src/types/database.ts` |
| File checks (GLB magic/version/length, USDZ zip, 25 MB cap, 5 MB warning) | `src/lib/ar/model-file.ts` (+ `tests/unit/ar/model-file.test.ts`) |
| Upload API | `POST /api/admin/products/upload-ar-model` (multipart `file`, `format=glb\|usdz`) |
| Back office | `src/app/(admin)/menu/products/[id]/ProductArTab.tsx` |
| Viewer | `src/components/ar/ModelViewer.tsx`, `ArViewerSheet.tsx`, `ar-copy.ts` (15 languages) |
| Public menu | `productArModelByProductId` in `src/lib/menu/public-menu-data.ts` → `MenuPage` → `ProductModal` |
| Analytics | `model_viewer_opened`, `ar_launched` (client events, `source: 'detail'`) |
| Headers | `Permissions-Policy: xr-spatial-tracking=(self)` in `next.config.ts` |

### Data model

`product_ar_models` holds one row per dish (`product_id` is unique):
`glb_url` (required), optional `usdz_url`, `poster_url`, `real_scale` (AR at
the modelled size), storage keys and byte sizes. Reads follow `product_media`
(members, superadmin, or a dish on a public menu); writes are managers only.
A trigger rejects a row whose `tenant_id` is not the dish's tenant. The public
menu selects only `product_id, glb_url, usdz_url, poster_url, real_scale`.

Before the migration runs, the public menu query fails quietly and no dish
shows "View in 3D", so the code can ship first.

## Before it works in production

1. **Apply the migration.** `npm run db:migrate` lists it; `--only=20261107090000_product_ar_models.sql --apply`
   applies it. The connection string in `.env.local` points at the live
   database, so do it on purpose.
2. **CORS on the R2 bucket `xmartmenu-product-images`.** `<model-viewer>`
   downloads the GLB with `fetch`, which needs `Access-Control-Allow-Origin`.
   Today the R2 custom domains return no CORS headers (checked 2026-11-07), so
   the viewer shows "The 3D model could not be loaded". Restaurants also use
   custom domains, so allow any origin for reads:

   ```json
   [{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
   ```

   The shared `CLOUDFLARE_TOKEN` is DNS-only; this needs a token with R2 edit
   rights or the Cloudflare dashboard (R2 › bucket › Settings › CORS policy).
3. Test on a real Android phone and a real iPhone (AR cannot be emulated).

## Model guidelines for restaurants

- glTF Binary (`.glb`), glTF 2.0, units in **metres** at the dish's real size
  (a 26 cm plate is 0.26 wide) so "real size" AR shows the true portion.
- Under 5 MB: compress textures (KTX2/WebP) and geometry (Draco or meshopt),
  e.g. `npx @gltf-transform/cli optimize in.glb out.glb`.
- Origin at the bottom centre of the plate, so it sits on the table.
- Photogrammetry apps (Polycam, Luma, RealityScan) export usable GLBs from a
  phone scan of the real dish.

## Open follow-ups

- **Plan gating**: AR is shown whenever a dish has a model. If it becomes a
  paid feature, add a plan feature key next to `orders`/`payments`.
- **Storage cleanup**: replaced/removed files stay in the bucket; the
  `*_storage_path` columns are there for a cleanup job.
- **Model pipeline**: server-side optimisation (gltf-transform) and USDZ
  generation on upload; AI or photogrammetry generation from dish photos.
- **Feed entry point**: a 3D badge on dish cards in the grid and the visual
  feed (today the entry is the dish detail only).
- **Dashboard**: the two events are recorded but not yet shown in the menu
  analytics dashboard.
