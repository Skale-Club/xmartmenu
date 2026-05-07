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

## Current Milestone: v1.4 Performance

**Goal:** Medir performance real do sistema e otimizar os gargalos encontrados — DB queries, bundle, Core Web Vitals e observabilidade em produção.

**Target features:**
- Instrumentação: analisar Vercel Speed Insights + query logging no Supabase
- DB indices: EXPLAIN ANALYZE nas queries críticas (menu público, pedidos, tenant lookup) + índices onde necessário
- Lighthouse audit: landing page + /{slug} público — metas definidas após medição
- Bundle: tree-shaking, lazy loading, ISR tuning
- RUM: dashboards de Core Web Vitals por rota

## Current State

**v1.3 Landing Page shipped (2026-05-07)** — Static marketing page live at xmartmenu.skale.club.

Landing page at `src/app/(marketing)/page.tsx` (`force-static`):
- 7 sections: nav, hero, how-it-works, feature blocks, FAQ, CTA, footer
- Middleware bypasses `getUser()` for `/` to eliminate Supabase latency on marketing route
- Reserved paths (`RESERVED_PATHS` Set) shared between middleware and onboarding API
- Vercel Analytics + Speed Insights installed

SEO at `src/app/`:
- `sitemap.ts` — MetadataRoute.Sitemap listing only `/` (no tenant roster leak)
- `robots.ts` — MetadataRoute.Robots with Disallow for all private paths
- `opengraph-image.tsx` — 32.6 KB PNG via ImageResponse (flat CSS, no fetch)
- JSON-LD Organization + SoftwareApplication inline in page.tsx via `dangerouslySetInnerHTML`
- `og:image` meta tag: explicit `openGraph.images` in root layout (file convention alone insufficient)

*v1.2 AI Onboarding (2026-05-07)*: Text seeding (Gemini 2.5 Flash), image seeding (Nano Banana 2), menu photo OCR (GPT-4.1-mini) — all superadmin-only, additive.
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

### Active — v1.4

- [ ] Instrumentação e coleta de dados de performance reais (Speed Insights, query logs)
- [ ] DB indices nas queries críticas com base em EXPLAIN ANALYZE
- [ ] Lighthouse 90+ na landing page e no menu público
- [ ] Bundle otimizado (lazy loading, tree-shaking, ISR tuning)
- [ ] RUM: Core Web Vitals por rota em produção

### Deferred (seeds)

- SEED-003 — Stripe Connect payments (tenant-owned accounts)
- SEED-004 — Full performance milestone (DB indices, RUM, Lighthouse budget)
- SEED-005 — ✅ Marketing landing page (shipped v1.3)

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

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-05-07 — v1.4 Performance milestone started*
