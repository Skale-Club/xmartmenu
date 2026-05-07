# xmartmenu

## What This Is

Multi-tenant SaaS platform that lets restaurants create and share digital menus via QR code. Restaurant owners sign up, configure their menu (categories, products, images, multi-language), and share a public URL that customers scan at the table. Customers can view the menu and place orders directly. AI-assisted onboarding (v1.2) will collapse the initial setup from ~1h to minutes.

**Production domain:** xmartmenu.skale.club

## Core Value

A restaurant owner can go from zero to a live, shareable digital menu in under 10 minutes — no design skills, no developer needed.

## Stack

- **Frontend/Backend:** Next.js 16.2 (App Router, React 19, TypeScript)
- **Database + Auth:** Supabase (PostgreSQL + RLS + Auth)
- **Styling:** Tailwind CSS 4
- **Deployment:** Vercel
- **Package manager:** npm

## Users & Roles

| Role | Description |
|---|---|
| `superadmin` | Platform operator — manages all tenants |
| `store-admin` | Restaurant owner — manages their menu, staff, settings |
| `store-staff` | Read-only access to their restaurant's data |
| Public visitor | Customer scanning QR code — sees menu, can place orders |

## Current Milestone: v1.2 AI Onboarding

**Goal:** Reduzir o setup de um novo restaurante de ~1h de digitação para minutos via 3 caminhos independentes de AI.

**Target features:**
- Text seeding — gerar categorias, descrições e copy via LLM baseado no tipo de negócio
- Image seeding — gerar foto de capa e por-item via modelo de imagem (opt-in, rate-limited)
- Menu photo OCR — foto do cardápio físico → OCR + LLM → itens estruturados + tela de review antes de salvar

## Current State

**v1.2 Phase 10 complete (2026-05-07)** — AI image seeding operational in superadmin panel (programmatic verification; runtime UAT pending).
- Gemini 3.1 flash-image-preview generates cover photo (16:9) + per-product images (1:1) via GitHub Actions
- Pipeline: Vercel trigger route → GH Actions workflow_dispatch → `scripts/seed-images.ts` → base64 → Sharp WebP @ 85 → Supabase Storage `tenant-assets` → revalidatePath
- `ai_jobs` table tracks job status (pending → running → complete | failed); UI polls every 3s, ~5 min timeout
- "Seed all images" + per-product "Seed image" buttons in superadmin tenant detail
- Requires: GH Actions secrets (5) + Vercel env vars (4: `GH_PAT`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `VERCEL_REVALIDATE_SECRET`) + Supabase migration 023

**v1.2 Phase 9 complete (2026-05-06)** — AI text seeding operational in superadmin panel.
- Gemini 2.5 Flash generates English categories, products, restaurant copy, and translations
- `sanitizeForPrompt()` guards all LLM inputs; `ai_usage` table tracks cost per tenant
- AI Tools section in superadmin tenant detail: bulk seed + per-item "Seed category/product"
- Requires: `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local` + Supabase migration 022

*v1.1 complete (2026-05-06)*: Orders system — 8 phases, 11 plans. Cart, checkout, option groups, admin orders view.
- Items count column in order list table (singular/plural, ORD-20)
- `selected_options` summary per item in detail modal, Notes section above status (ORD-21)

*Phase 7 (2026-05-06)*: Checkout: order placed, confirmation screen shown.
*Phase 6 (2026-05-06)*: Public menu option selectors + cart (radio/checkbox/half-and-half, composite cartKey).
*Phase 5 (2026-05-06)*: Admin option group CRUD at `/admin/menu/products/[id]`.

*Phase 4 (2026-05-06)*: DB schema — product_option_groups, product_options, orders v1.1, TypeScript types.
*v1.0 Foundation (2026-05-06)*: 3 phases, 6 plans. ISR caching, 3 security fixes, CI/CD.

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

### Active — v1.2

- [ ] AI image seeding: cover photo via gpt-image-1-mini + Pexels/Unsplash per-product (Phase 10)
- [ ] Menu photo OCR: GPT-4.1-mini vision → categories/items/prices → direct DB write (Phase 11)

### Deferred (seeds)

- SEED-003 — Stripe Connect payments (tenant-owned accounts)
- SEED-004 — Full performance milestone (DB indices, RUM, Lighthouse budget)
- SEED-005 — Marketing landing page (xmartmenu.skale.club)

### Out of Scope

- Native mobile app — web-first, responsive is sufficient
- Self-hosted Supabase — managed Supabase only for now
- Stripe integration — deferred to SEED-003 (after orders ship)
- Lighthouse CI / performance budget — deferred to SEED-004

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
| In-memory cart (no localStorage) | Matches skleanings pattern, avoids state-sync complexity | Planned v1.1 |
| Option groups for product variants | pizza sizes + half-and-half require structured groups, not flat addons | Planned v1.1 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-05-07 after Phase 10 (AI Image Seeding)*
