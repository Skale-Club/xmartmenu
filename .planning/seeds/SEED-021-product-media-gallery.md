---
id: SEED-021
status: complete
planted: 2026-05-19
planted_during: v2.2-milestone-execution
trigger_when: improving product presentation, working on the public menu UX, or adding rich media to the menu
scope: medium
---

# SEED-021: Product Media Gallery (Multi-Photo + Video)

## Why This Matters

Today each product has a single photo. A dish worth ordering deserves more than one angle — a close-up, a plating shot, the portion size next to a fork. Video is even better: a 5-second clip of a burger being assembled or a cocktail being poured converts better than any static image.

**Display rules:**
- **Product grid / showcase** — always shows the first registered image (primary photo). No change to the grid layout.
- **Product detail modal** — when a video is available, it plays first (autoplay muted, loop). Images follow as a swipeable carousel. When no video, carousel starts with the first image.

**Admin UX:**
- Multi-image upload in the product editor: drag-and-drop reorder, delete per image, clear first-image designation
- Video: URL input (YouTube, Vimeo, or direct `.mp4` upload). One video per product in v1.
- Existing single `image_url` field on products is preserved as the primary/first image slot — backward compatible.

## When to Surface

**Trigger:** when improving the public menu product detail experience, or when restaurants ask for richer product media

Surface during `/gsd:new-milestone` when the scope involves:
- Public menu UX improvements
- Product presentation quality
- Rich media for menus (video, galleries)
- Conversion optimization on the product detail view

## Scope Estimate

**Medium** — 2–4 days. Components:

### Phase A: DB schema + types
- New `product_media` table: `(id, product_id, tenant_id, type TEXT CHECK(type IN ('image', 'video')), url TEXT, storage_path TEXT, display_order INT, created_at)`
- `display_order` controls the carousel sequence; order = 0 is the primary image (shown in grid)
- `storage_path` for uploaded files (Supabase Storage via `IStorageClient`); `url` for external video embeds (YouTube/Vimeo)
- Existing `products.image_url` stays as the authoritative primary image for backward compat; synced with `display_order = 0` entry on migration
- RLS: tenant isolation via `tenant_id`

### Phase B: Admin product editor
- New "Media" tab in the product editor (alongside Details / Options / Ingredients)
- Multi-image upload: up to 8 images, drag-and-drop reorder, WebP conversion via existing Sharp pipeline
- First image in the list is designated as "primary" — shown in grid and as `products.image_url`
- Video field: URL input accepting YouTube (`youtu.be`, `youtube.com/watch`), Vimeo, or direct `.mp4` upload
- One video per product in v1
- Preview thumbnails for all media in the editor

### Phase C: Public menu — carousel + video in ProductModal
- ProductModal carousel: horizontal swipe (touch) + arrow buttons (desktop)
- When a video is available: video player as the first item in the media sequence
  - YouTube/Vimeo: embedded `<iframe>` with `autoplay=0` (no autoplay — user taps play)
  - Direct `.mp4`: `<video autoplay muted loop playsinline>` (autoplays silently, respects iOS Safari `playsinline`)
- Images after the video: same WebP + `next/image` pattern as today
- Dot indicators at the bottom of the carousel (video = play icon dot, images = circle dots)
- Product grid thumbnail: always `products.image_url` (primary image) — no change to grid layout

### Phase D: AI seeding integration
- AI image seeding (Phase 10, v1.2) currently generates one image per product
- When SEED-021 is active, the seeder can generate multiple images per product (e.g. 2–3 angles)
- This is an enhancement to the existing seeder — not a new seeder

## Breadcrumbs

- `supabase/migrations/` — `product_media` table + RLS policies
- `src/types/database.ts` — `ProductMedia` type
- `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx` — new "Media" tab
- `src/app/api/admin/products/upload/route.ts` — existing Sharp WebP upload; extend to accept multiple images
- `src/components/menu/ProductModal.tsx` — carousel + video player replacing single image
- `src/lib/get-active-menu.ts` — fetch `product_media` alongside products for the public page
- `src/lib/storage/index.ts` — `IStorageClient` for multi-image upload

## Notes

- **Backward compatible** — `products.image_url` stays and continues to serve as the grid thumbnail. Products with no entries in `product_media` continue to work exactly as today. The migration seeds one `product_media` row (type=image, display_order=0) from the existing `image_url` for every product that already has a photo.
- **Video embed vs upload** — v1 supports both URL embeds (YouTube/Vimeo — no storage cost, no encoding) and direct `.mp4` upload (stored in Supabase Storage). Embed is preferred for high-quality video; upload for short clips (<30s).
- **No autoplay with sound** — the browser autoplay policy blocks audio autoplay. Direct video: `autoplay muted loop playsinline` (silent loop). YouTube/Vimeo embeds: user must tap play. This is the correct UX — not surprising the customer with sound in a quiet restaurant.
- **Mobile swipe** — the carousel must support touch swipe gestures. Use `touchstart`/`touchend` delta tracking or a lightweight library like `embla-carousel` (no shadcn dependency, tree-shakeable).
- **Display order sync** — when the admin reorders images, `products.image_url` must be updated to match the new `display_order = 0` image. Keep these two sources in sync on every save.
- **8-image limit** — prevents storage bloat and keeps the carousel UX manageable. Enforced in the admin upload UI.
