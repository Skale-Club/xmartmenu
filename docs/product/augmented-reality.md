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
| Schema, production (owned PostgreSQL) | `docs/owned-schema/20261107090000_product_ar_models.sql` |
| Schema, legacy Supabase | `supabase/migrations/20261107090000_product_ar_models.sql` |
| Types | `ProductArModel`, `PublicProductArModel` in `src/types/database.ts` |
| File checks (GLB magic/version/length, USDZ zip, 25 MB cap, 5 MB warning) | `src/lib/ar/model-file.ts` |
| Upload API | `POST /api/admin/products/upload-ar-model` (multipart `file`, `format=glb\|usdz`) |
| Back-office reads/writes, owned DB | entity `ar` of `POST /api/admin/products/[id]/catalog` (`src/lib/data/admin-product-ar.ts`) |
| Back office UI | `src/app/(admin)/menu/products/[id]/ProductArTab.tsx` (owned API, or Supabase in legacy mode) |
| Viewer | `src/components/ar/ModelViewer.tsx`, `ArViewerSheet.tsx`, `ar-copy.ts` (15 languages) |
| Public menu | `productArModelByProductId`: owned loader `src/lib/data/public-menu.ts`, legacy loader `src/lib/menu/public-menu-data.ts` → `MenuPage` → `ProductModal` |
| Analytics | `model_viewer_opened`, `ar_launched` (client events, `source: 'detail'`) |
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
