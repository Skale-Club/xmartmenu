# xmartmenu

## What This Is

Multi-tenant SaaS platform that lets restaurants create and share digital menus via QR code. Restaurant owners sign up, configure their menu (categories, products, images, multi-language), and share a public URL that customers scan at the table. Customers can view the menu — ordering and payments are coming in v1.1.

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

## Current State

**v1.1 Phase 8 complete (2026-05-06)** — Tenant Orders View: Items count column + selected_options + notes in admin orders UI.
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

### Active — v1.1

- [ ] Customer order system (cart + addons + product option groups)
- [ ] Half-and-half pizza support (type = 'half_and_half' option group)
- [ ] Order confirmation flow + tenant-side order list

### Deferred (seeds)

- SEED-001 — AI-powered tenant onboarding (text/image/menu-photo)
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
*Last updated: 2026-05-06 after Phase 8 (Tenant Orders View) — v1.1 milestone complete*
