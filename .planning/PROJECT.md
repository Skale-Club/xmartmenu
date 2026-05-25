# xmartmenu

## What This Is

Multi-tenant SaaS platform that lets restaurants create and share digital menus via QR code. Restaurant owners sign up, configure their menu (categories, products, images, multi-language), and share a public URL that customers scan at the table. Customers can view the menu and place orders directly. Superadmins can now seed a tenant's full menu in seconds using AI text generation, AI image generation, and menu photo OCR — collapsing onboarding from ~1h to minutes.

**Production domain:** xmartmenu.skale.club

## Core Value

A restaurant owner can go from zero to a live, shareable digital menu in under 10 minutes — no design skills, no developer needed.

## Stack

- **Frontend/Backend:** Next.js 16.2 (App Router, React 19, TypeScript)
- **Database + Auth:** Supabase (PostgreSQL + RLS + Auth)
- **Styling:** Tailwind CSS 4
- **Deployment:** Vercel
- **Package manager:** npm
- **AI providers:** Google Generative AI (Gemini 2.5 Flash text, Gemini 3 Pro Image), OpenAI (GPT-4.1-mini OCR)

## Users & Roles

| Role | Description |
|---|---|
| `superadmin` | Platform operator — manages all tenants, runs AI seeding tools |
| `store-admin` | Restaurant owner — manages their menu, staff, settings |
| `store-staff` | Read-only access to their restaurant's data |
| Public visitor | Customer scanning QR code — sees menu, can place orders |

## Current Milestone: v2.3 Brand & Marketing Refresh

**Goal:** Rebrand the platform from yellow-lime to red, fix broken DB icon resolution on the marketing page, improve the features section layout for all screen sizes, and upgrade the CTA section with a full-bleed restaurant background image.

**Target features:**
- Global color rebrand: primary `#EEFF00` → `#F52323` across 45+ files, foreground flips to white (SEED-026)
- Icon resolver fix: `ClientPage.tsx` DB-driven icons actually work; `FoodDrinkCombo` icon registered (SEED-025)
- Features layout: 4-column desktop, 2-column tablet, 1-column phone; Online Ordering icon updated (SEED-027)
- CTA section: full-bleed card with restaurant background image, glass effect preserved, text untouched (SEED-028)
- DB seeds updated to reflect new red primary color defaults (SEED-029)

## Current State

**v2.3 Brand & Marketing Refresh in progress** — SEED-025 complete; SEED-026, SEED-027, SEED-028, SEED-029 pending

v2.2 delivers multi-location branches, order type selection (dine-in/pick-up/delivery), dynamic color theming per tenant, app-wide English conversion, and robust per-tenant SEO.

**v2.1 Custom Domains shipped (2026-05-10)** — SEED-010: custom domain routing

v2.1 delivered custom domain support per tenant: `sitedocliente.com` instead of `xmartmenu.skale.club/nomedocliente`.

**v2.0 Monetization shipped (2026-05-09)** — SEED-009: Plans, Pricing & Stripe Connect Monetization

Key deliverables:
- Plans table with configurable monthly/annual pricing + transaction fee
- Tenant subscriptions with override support for custom pricing
- Stripe Connect OAuth flow for payments-tier tenants
- Webhook handlers with idempotency for payment events
- Tenant-facing subscription management UI

**v1.9 Performance Gaps shipped (2026-05-08)** — SEED-004 gaps closed: profiles RLS indices, CDN cache headers, MenuPage decomposed.

Key changes in v1.9:
- Migration 028: `idx_profiles_tenant`, `idx_profiles_role`, `idx_profiles_tenant_role` — eliminam Seq Scan nos helpers RLS em toda query autenticada
- CDN `Cache-Control: public, max-age=31536000, immutable` via `updateBucket()` nos buckets `tenant-assets` e `product-images`
- `MenuPage.tsx` 1522 → 726 linhas (−52%): `ProductModal.tsx` + `CartModal.tsx` extraídos com `next/dynamic ssr:false`; `menu-utils.ts` com tipos/consts compartilhados

*v1.8 KDS+ (2026-05-08)*: configurable thresholds, filter chips, Web Audio beep.

Key changes in v1.8:
- Migration 027: `amber_threshold_minutes` (default 10) + `red_threshold_minutes` (default 20) on `tenant_settings`
- `useElapsedTime(createdAt, amberMinutes, redMinutes)` — parameterized, no hardcoded constants
- Store Settings: "KDS — Alertas de tempo" section with validated numeric inputs (amber < red, both > 0)
- Filter chips: Ativos (pending+preparing, default)/Pendentes/Em preparo/Prontos/Todos — persisted in localStorage
- `playBeep()` via Web Audio API on Realtime INSERT only; Bell/BellOff mute button persisted in localStorage

*v1.7 Customization (2026-05-08)*: Ingredient catalog, admin CRUD, customer stepper panel, kitchen display.
*v1.6 Operations (2026-05-08)*: KDS dashboard, Supabase Realtime, per-item notes.

Key changes in v1.7:
- Migration 026: `ingredients` + `product_ingredients` tables with RLS + `ingredient_customization_enabled` flag + `ingredient_modifications JSONB` on `order_items`
- `/admin/menu/ingredients` CRUD (flag-gated) + "Ingredientes" tab in product editor (multi-select picker, `is_default` toggle, per-product price overrides)
- `ProductModal`: stepper chips −/0/+ for default ingredients + inline "Adicionar ingrediente" picker; live price delta; `buildIngredientModifications` → JSONB → DB
- KDS OrderCard + admin orders modal: "SEM [name]" red/strikethrough, "+qty [name]" amber, "+qty [name]" green

*v1.6 Operations (2026-05-08)*: KDS dashboard, Supabase Realtime, per-item notes.

Key changes in v1.6:
- `useElapsedTime` hook (30s tick) + corrected `STATUS_COLORS` (pending=blue) + `OrderCard` grid — KDS card view for kitchen tablet
- Grid/list toggle persisted per-tenant in `localStorage`; status advance buttons with optimistic PATCH
- Supabase Realtime subscription on `orders` table (with follow-up `order_items` query) + 15s polling fallback
- `item_notes_enabled` flag on `tenant_settings`; textarea "Observações" (max 140 chars) on product modal; `sanitizeNote` server-side
- Migration 025 applied: `order_items.notes TEXT`, `tenant_settings.item_notes_enabled`, `ALTER PUBLICATION supabase_realtime ADD TABLE orders`

*v1.5 Image Optimization (2026-05-08)*: WebP upload enforcement, admin next/image migration, IStorageClient abstraction, migration 024 DB indices.

Key changes in v1.5:
- New server-side upload route `/api/admin/products/upload` — `sharp` runs server-side, WebP enforced for all product images
- Superadmin `upload/route.ts` and `seed-image/route.ts` also convert via `convertBufferToWebP`
- `next.config.ts`: `formats: ['image/webp']`, `deviceSizes: [640, 750, 828, 1080, 1200, 1920]`
- `BrandingClient.tsx`, `ProductsClient.tsx`, `TenantsClient.tsx`, `TenantDetailClient.tsx` — all raw `<img>` → `next/image`
- `src/lib/storage/index.ts`: `IStorageClient` + `SupabaseStorageClient` (default) + `S3StorageClient`; migrate to Hetzner by setting `STORAGE_PROVIDER=s3` + 3 S3 env vars
- DB migration 024 applied: 4 indices eliminate sequential scans on every public menu page load

*v1.4 Performance (2026-05-08)*: Bundle analysis, DB indices, next/image on public menu, Lighthouse CI gate (0.88 mobile).
*v1.3 Landing Page (2026-05-07)*: Static marketing page, OG image, SEO metadata, JSON-LD.
*v1.2 AI Onboarding (2026-05-07)*: Text seeding, image seeding, menu photo OCR — all superadmin-only.
*v1.1 Orders (2026-05-06)*: Cart, checkout, option groups, orders view.
*v1.0 Foundation (2026-05-06)*: ISR caching, security, CI/CD.

## Requirements

### Validated — v1.0

- ✓ Multi-tenant architecture with RLS isolation
- ✓ QR code generation per menu
- ✓ Multi-language menu support (categories, products, i18n per tenant)
- ✓ Product images (upload + WebP conversion via Sharp)
- ✓ Admin panel (menus, categories, products, staff, settings, branding)
- ✓ Superadmin panel (all tenants, users, global settings)
- ✓ Tenant onboarding wizard
- ✓ Staff management with forced password reset
- ✓ Orders schema + feature flags (orders_enabled, direct_orders_enabled)
- ✓ Public menu page at /{tenantSlug}/{menuSlug}
- ✓ Public menu ISR caching (revalidate=60, React cache(), parallel fetch) — v1.0
- ✓ Orders API validates tenant + orders_enabled before insert — v1.0
- ✓ must_change_password enforced at API layer (staff routes) — v1.0
- ✓ Unified superadmin auth via assertSuperadmin() — v1.0
- ✓ CI: lint + build gate on all PRs — v1.0
- ✓ browserslist targets modern browsers (smaller polyfills) — v1.0

### Validated — v1.1

- ✓ DB schema: product_option_groups, product_options, orders v1.1, order_items v1.1 — Phase 4
- ✓ TypeScript types for all 4 new tables — Phase 4
- ✓ Admin UI: option group + option CRUD, adaptive price field, ↑↓ reorder — Phase 5
- ✓ Public menu: option selectors (radio/checkbox/half-and-half), cart with composite keys, unitPrice — Phase 6
- ✓ Checkout: selected_options to DB, order confirmation screen with order ID, items, total — Phase 7
- ✓ Tenant orders view: Items count column, selected_options summary, notes in admin UI — Phase 8

### Validated — v1.2

- ✓ AI text seeding (superadmin): Gemini 2.5 Flash → categories, products, copy, translations — Phase 9
- ✓ Infrastructure: ai_usage tracking, sanitizeForPrompt, revalidatePath, migration 022 — Phase 9
- ✓ AI image seeding (superadmin): Nano Banana 2 → cover + per-product WebP photos via Supabase Storage — Phase 10
- ✓ Menu photo OCR (superadmin): GPT-4.1-mini vision → structured DB writes via signed URL upload — Phase 11
- ✓ All AI seeding is additive (never overwrites existing content) — Phases 9–11

### Validated — v1.3

- ✓ Static marketing landing page (7 sections, `force-static`, Server Components only) — Phase 12
- ✓ Middleware bypass: no `getUser()` on `/` — Phase 12
- ✓ Reserved paths guard shared by middleware + onboarding API — Phase 12
- ✓ Vercel Analytics + Speed Insights — Phase 12
- ✓ OG image (ImageResponse, 32.6 KB PNG, WhatsApp-safe) — Phase 12/13
- ✓ sitemap.xml listing only `/` — Phase 13
- ✓ robots.txt with correct Disallow rules — Phase 13
- ✓ JSON-LD Organization + SoftwareApplication (page-scoped, not in layouts) — Phase 13
- ✓ `og:image` meta tag with absolute URL via metadataBase — Phase 13

### Validated — v1.4

- ✓ Instrumentação: bundle analysis (819 KB overhead), PageSpeed Insights (landing 100, /{slug} 94)
- ✓ ISR revalidate=60 kept. Chunk 5536 = Supabase browser client (deferred separation)
- ✓ Lighthouse CI: .github/workflows/lighthouse-ci.yml — threshold 0.88 mobile
- ✓ next/image migration for public MenuPage.tsx (banner, logo, product cards, modal)

### Validated — v1.5

- ✓ WebP enforced on all upload paths (admin product upload via server route, superadmin upload/seed routes) — Phase 18
- ✓ `next.config.ts`: `formats: ['image/webp']`, `deviceSizes` configured — Phase 18
- ✓ `BrandingClient.tsx` logo + banner → `next/image` with correct sizing — Phase 19
- ✓ `ProductsClient.tsx` admin grid + upload preview → `next/image` — Phase 19
- ✓ `TenantsClient.tsx` + `TenantDetailClient.tsx` tenant logos → `next/image` — Phase 19
- ✓ `IStorageClient` abstraction: swap Supabase→Hetzner/R2/AWS via `STORAGE_PROVIDER=s3` env var — Phase 20
- ✓ 5 server-side routes migrated to `getStorageClient()` (zero direct SDK calls in route handlers) — Phase 20
- ✓ Migration 024 applied: 4 indices eliminate sequential scans on public menu path — Phase 15/20

### Validated — v1.6

- ✓ KDS card grid: `useElapsedTime` hook, corrected `STATUS_COLORS`, `OrderCard`, responsive 1/2/3-col layout — Phase 21
- ✓ Grid/list toggle persisted per-tenant in `localStorage`; optimistic status PATCH — Phase 21
- ✓ Supabase Realtime subscription with follow-up `order_items` query + 15s polling fallback — Phase 22
- ✓ `item_notes_enabled` flag on `tenant_settings`; customer textarea 140-char with live counter — Phase 22
- ✓ `sanitizeNote` server-side (strip control chars, trim, cap 140) on orders POST — Phase 22
- ✓ Migration 025 applied: `order_items.notes`, `tenant_settings.item_notes_enabled`, Realtime publication — Phase 22

### Validated — v1.7

- ✓ Migration 026: `ingredients`, `product_ingredients`, `ingredient_customization_enabled`, `ingredient_modifications JSONB` with RLS — Phase 23
- ✓ `/admin/menu/ingredients` CRUD (flag-gated) + ChevronUp/Down reorder + Ingredientes nav in sidebar — Phase 24
- ✓ "Ingredientes" tab in product editor: multi-select picker + `is_default` toggle + per-product price overrides — Phase 24
- ✓ Customer customization panel in `ProductModal`: stepper chips + "Adicionar ingrediente" inline picker + live price delta — Phase 25
- ✓ `buildIngredientModifications` → null when empty → JSONB persisted in `order_items` — Phase 25
- ✓ KDS card + admin orders modal render SEM/extras/additions with color-coded text — Phase 25

### Validated — v1.8

- ✓ Migration 027: `amber_threshold_minutes` + `red_threshold_minutes` with defaults 10/20 — Phase 26
- ✓ `useElapsedTime` parameterized (no hardcoded constants); Store Settings KDS section with validation — Phase 26
- ✓ Filter chips (Ativos/Pendentes/Em preparo/Prontos/Todos) with localStorage persistence — Phase 27
- ✓ Web Audio API beep on Realtime INSERT only, guarded by muted state — Phase 27
- ✓ Bell/BellOff mute button with `kds_mute_{tenantId}` localStorage persistence — Phase 27

### Validated — v1.9

- ✓ Migration 028: `idx_profiles_tenant`, `idx_profiles_role`, `idx_profiles_tenant_role` on `profiles` — eliminates Seq Scans in `auth_tenant_id()` + `is_superadmin()` RLS helpers — Phase 28
- ✓ CDN `Cache-Control: public, max-age=31536000, immutable` on `tenant-assets` + `product-images` Storage buckets — Phase 28
- ✓ `ProductModal.tsx` extracted from `MenuPage.tsx` with `next/dynamic ssr:false` — Phase 29
- ✓ `CartModal.tsx` extracted from `MenuPage.tsx` with `next/dynamic ssr:false` — Phase 29
- ✓ `MenuPage.tsx` reduced 1522→726 lines (−52%); `menu-utils.ts` as shared types/constants module — Phase 29

### Deferred (seeds)

- SEED-003 — Stripe Connect payments (tenant-owned accounts)
- SEED-004 — ✅ Performance gaps (shipped v1.9: profiles indices + CDN + MenuPage decomposition)
- SEED-005 — ✅ Marketing landing page (shipped v1.3)
- SEED-007 — ✅ KDS dashboard + Phase B (shipped v1.6 + v1.8)
- SEED-008 Phase D — ✅ per-item notes (shipped v1.6)

### Out of Scope

- Native mobile app — web-first, responsive is sufficient
- Self-hosted Supabase — managed Supabase only for now
- Stripe integration — deferred to SEED-003
- Lighthouse CI / performance budget — deferred to SEED-004
- Tenant-facing AI tools — AI seeding is superadmin-only by design
- Review screen before AI commits — superadmin corrects via regular admin UI

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Next.js App Router | SSR for public menu SEO + server components for data fetching | ✓ Shipped |
| Supabase RLS | Defense-in-depth multi-tenant isolation at DB layer | ✓ Shipped |
| Turbopack (default) | 2.25× faster builds than webpack | ✓ Active |
| ISR revalidate=60 for public menu | Menus change rarely; 60s cache acceptable for v1 | ✓ Shipped v1.0 |
| React cache() for metadata dedup | Eliminates duplicate tenant DB query per request | ✓ Shipped v1.0 |
| Stripe Connect (not platform-held) | Tenants own their Stripe account, platform takes fee | Planned (SEED-003) |
| Path-based tenant URLs (`/{slug}`) | Simple, existing pattern — namespace collision risk noted | ✓ Shipped |
| In-memory cart (no localStorage) | Matches skleanings pattern, avoids state-sync complexity | ✓ Shipped v1.1 |
| Option groups for product variants | pizza sizes + half-and-half require structured groups | ✓ Shipped v1.1 |
| AI seeding is superadmin-only | Managed onboarding service model; tenants edit via regular admin UI | ✓ Shipped v1.2 |
| No review screen for AI output | Direct DB writes; correction happens in admin UI after seeding | ✓ Shipped v1.2 |
| Nano Banana 2 for image generation | Single Google vendor for text + image; no Pexels/Unsplash attribution overhead | ✓ Shipped v1.2 |
| Supabase signed URL for OCR upload | Bypasses Vercel 4.5 MB body limit; no intermediate proxy needed | ✓ Shipped v1.2 |
| price=0 as parse-failure signal | No extra DB column; superadmin sees $0 and corrects in admin UI | ✓ Shipped v1.2 |
| Additive-only AI writes | Safe to re-run seeding without data loss; corrections via regular edit | ✓ Shipped v1.2 |
| `force-static` for marketing page | Eliminates Supabase `getUser()` latency on `/`; Lighthouse-safe | ✓ Shipped v1.3 |
| `(marketing)` route group | Isolates layout + metadata from tenant/admin routes | ✓ Shipped v1.3 |
| Reserved paths as shared Set | Single source of truth for middleware + onboarding API guard | ✓ Shipped v1.3 |
| `schema-dts` as devDependency | TypeScript types for JSON-LD; zero runtime footprint | ✓ Shipped v1.3 |
| Inline `dangerouslySetInnerHTML` for JSON-LD | `next/script` causes RSC hydration duplication in React 19 | ✓ Shipped v1.3 |
| `opengraph-image.tsx` at root `src/app/` | Route group placement serves route but doesn't inject `og:image` meta tag | ✓ Shipped v1.3 |
| Explicit `openGraph.images` in root layout | File convention alone insufficient when layouts override `openGraph` object | ✓ Shipped v1.3 |
| sharp behind server API route | sharp = native Node.js — cannot run in client components | ✓ Shipped v1.5 |
| `IStorageClient` factory pattern | Swap storage provider via env var; zero code changes required | ✓ Shipped v1.5 |
| Lazy `@aws-sdk` imports in S3StorageClient | Prevents SDK from entering client bundle when `STORAGE_PROVIDER=supabase` | ✓ Shipped v1.5 |
| Separate single-column indices on menus | UNIQUE(tenant_id,slug) composite doesn't serve single-column filters | ✓ Applied v1.5 |
| Realtime + polling simultaneously | Realtime for instant new-order appearance; polling replaces full state every 15s as safety net | ✓ Shipped v1.6 |
| Follow-up query after Realtime INSERT | INSERT payload carries only `orders` row — must re-fetch with `order_items(*)` join | ✓ Shipped v1.6 |
| `item_notes_enabled` on `tenant_settings` | Same pattern as `direct_orders_enabled`; opt-in per tenant | ✓ Shipped v1.6 |
| `CartItem.note` excluded from `buildCartKey` | Same product+options merges; re-adding replaces note (not creates duplicate slot) | ✓ Shipped v1.6 |
| `ingredients` catalog separate from `product_option_groups` | Ingredient semantics (default-on/tweak) vs option group semantics (pick-one-of-N) diverge enough to warrant separate tables | ✓ Shipped v1.7 |
| `buildIngredientModifications` returns `null` when all arrays empty | Store null, not `{}` — DB cleaner, display guard simpler (`hasAny`) | ✓ Shipped v1.7 |
| "Adicionar ingrediente" as inline expandable (not modal) | Avoids z-index conflicts inside the existing product overlay | ✓ Shipped v1.7 |
| Price override `defaultValue + onBlur` (not controlled) | Avoids per-keystroke DB writes; empty field → `null` → catalog default | ✓ Shipped v1.7 |
| 3 separate indices on profiles vs single composite | `auth_tenant_id()` filters by `user_id`→`tenant_id`, `is_superadmin()` by `role` alone — neither benefits from composite as secondary column | ✓ Shipped v1.9 |
| `UICopyEntry` explicit type alias in menu-utils.ts | `typeof UI_COPY[string]` doesn't cross module boundaries cleanly in tsc — explicit alias avoids inference issues | ✓ Shipped v1.9 |
| `next/dynamic ssr:false` for ProductModal + CartModal | Modal overlays are client-only; lazy-loading eliminates them from initial SSR HTML and first JS bundle | ✓ Shipped v1.9 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-05-19 — v2.2 Restaurant Growth Platform started*
