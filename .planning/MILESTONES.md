# Milestones

## v1.8 KDS+ (Shipped: 2026-05-08)

**Phases completed:** 2 phases, 2 plans, 4 tasks

**Key accomplishments:**

- Per-tenant KDS time thresholds: migration 027 adds amber/red columns (defaults 10/20), hook parameterised, settings UI wired with validation.

---

## v1.7 Customization (Shipped: 2026-05-08)

**Phases completed:** 3 phases, 5 plans, 7 tasks

**Key accomplishments:**

- Ingredients catalog page at /admin/menu/ingredients with full CRUD modal + ChevronUp/Down reorder, gated by ingredient_customization_enabled; Ingredientes nav item in AdminSidebar conditionally shown via prop from layout.tsx
- Tab bar (Detalhes / Opcoes / Ingredientes) added to product editor; Ingredientes tab delivers searchable catalog picker + per-product ingredient associations with is_default toggle and per-product price override fields
- KDS OrderCard and admin orders modal now render ingredient modifications with color-coded text: red/strikethrough for SEM removals, amber for extras, green for additions — completing the full INGR-10 requirement

---

## v1.6 Operations (Shipped: 2026-05-08)

**Phases completed:** 2 phases, 4 plans, 8 tasks

**Key accomplishments:**

- KDS card grid with useElapsedTime hook, corrected STATUS_COLORS (pending=blue, preparing=yellow), OrderCard component, and responsive 1/2/3-column layout replacing the orders table
- Supabase Realtime postgres_changes subscription + 15s polling fallback wired into OrdersClient, with migration 025 adding order_items.notes and item_notes_enabled flag, and per-item notes rendered with MessageSquare icon and italic styling in both KDS card and admin modal

---

## v1.5 Image Optimization (Shipped: 2026-05-08)

**Phases completed:** 18 phases, 38 plans, 47 tasks

**Key accomplishments:**

- Idempotent SQL migration extending the v1.0 schema with product_option_groups, product_options tables and orders/order_items column additions for the full Orders v1.1 feature set
- One-liner:
- OptionGroupForm and OptionForm inline CRUD components fully wired into ProductDetailClient.tsx — admin can add, edit, and reorder option groups and options with optimistic UI updates and Supabase persistence.
- Server component fetches product_option_groups with nested options, gated behind directOrdersEnabled, grouped by product_id, and passes optionGroupsByProductId prop to MenuPage
- One-liner:
- `selected_options` accepted in POST /api/orders and persisted to `order_items` table so cart option selections are no longer dropped
- Items count column and selected_options/notes display added to /admin/orders order table and detail modal
- Created the core seed API route (POST /api/superadmin/tenants/{id}/seed) handling all 6 AI text seeding operations with Gemini 2.5 Flash, additive-only DB writes, non-blocking usage logging, and ISR cache invalidation.
- AI Tools section added to superadmin tenant detail page — bulk seed buttons (Seed menu/categories/products/copy) plus per-item Seed category and Seed product with live category selector, all wired to the seed API from Plan 02
- OCR photo upload UI already delivered by Wave 2 agent in commit 58869bd; this plan is a documentation-only close-out
- Reserved-path guard + middleware marketing bypass + Vercel Analytics + root layout SEO metadata — all Phase 12 prerequisites wired.
- Full static marketing landing page with 7 sections (nav, hero, how-it-works, features, FAQ, footer CTA, footer) — Server Components only, force-static, zero client JS.
- OG image (ImageResponse, flat CSS, WhatsApp-safe) + placeholder /privacy and /terms pages — Phase 12 complete.
- One-liner:
- OG image file moved to root app level — og:image meta tag correctly injected at 33.4 KB (32.6 KB), 9x under the 300 KB WhatsApp limit; all four SEO checks verified and human-approved.
- 1. [Rule 1 - Bug] Fixed TypeScript type error in superadmin upload route

---

## v1.4 Performance (Shipped: 2026-05-08)

**Phases completed:** 4 phases, 9 plans, 15 tasks

**Key accomplishments:**

- Webpack bundle analysis run against production build — top 5 client chunks identified with lazy-load candidacy for 14-BASELINE.md
- One-liner:
- Migration audit confirmed 4 missing indices on the public menu query path: menus(tenant_id), menus(slug), categories(menu_id), products(menu_id) — all causing Seq Scans on every public page load.
- 4 missing PostgreSQL indices written to migration 024 eliminating Seq Scans on menus(tenant_id), menus(slug), categories(menu_id), and products(menu_id) on every public menu page load
- Chunk 5536 composition identified as @supabase/ssr browser client in AdminSidebar; ISR revalidate = 60 retained on all public menu routes; FE-04 satisfied

---

## v1.3 Landing Page (Shipped: 2026-05-07)

**Phases completed:** 2 phases, 5 plans, 10 tasks

**Key accomplishments:**

- Reserved-path guard + middleware marketing bypass + Vercel Analytics + root layout SEO metadata — all Phase 12 prerequisites wired.
- Full static marketing landing page with 7 sections (nav, hero, how-it-works, features, FAQ, footer CTA, footer) — Server Components only, force-static, zero client JS.
- OG image (ImageResponse, flat CSS, WhatsApp-safe) + placeholder /privacy and /terms pages — Phase 12 complete.
- One-liner:
- OG image file moved to root app level — og:image meta tag correctly injected at 33.4 KB (32.6 KB), 9x under the 300 KB WhatsApp limit; all four SEO checks verified and human-approved.

---

## v1.2 AI Onboarding (Shipped: 2026-05-07)

**Phases completed:** 3 phases, 8 plans, 14 tasks

**Key accomplishments:**

- Created the core seed API route (POST /api/superadmin/tenants/{id}/seed) handling all 6 AI text seeding operations with Gemini 2.5 Flash, additive-only DB writes, non-blocking usage logging, and ISR cache invalidation.
- AI Tools section added to superadmin tenant detail page — bulk seed buttons (Seed menu/categories/products/copy) plus per-item Seed category and Seed product with live category selector, all wired to the seed API from Plan 02
- Nano Banana 2 (gemini-3.1-flash-image-preview) image generation backend — cover banner and per-product WebP photos via generateImage(), Sharp conversion, and Supabase Storage upload — with additive guards and ai_usage tracking.
- TenantDetailClient extended with Seed cover, Seed product images, and single-product Seed image controls inside the existing AI Tools section — calling the seed-image route with per-button loading states, slow-operation warnings, and success/error banners.
- OCR photo upload UI already delivered by Wave 2 agent in commit 58869bd; this plan is a documentation-only close-out

---

## v1.0 Foundation (Shipped: 2026-05-06)

**Phases completed:** 3 phases, 6 plans, 2 tasks

**Key accomplishments:**

- 1. [Rule 1 - Bug] Removed erroneous `await` before synchronous createServiceClient()
- browserslist added to package.json targeting modern browsers to reduce polyfill bundle from 109 KB to ~60-80 KB; PERF-02 confirmed — public routes import only supabase/server

---
