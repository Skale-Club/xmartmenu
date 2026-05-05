# xmartmenu

## What This Is

Multi-tenant SaaS platform that lets restaurants create and share digital menus via QR code. Restaurant owners sign up, configure their menu (categories, products, images, multi-language), and share a public URL that customers scan at the table.

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

## Requirements

### Validated (already shipped)

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
- ✓ Performance baseline (bundle analysis, SEED-004 started)

### Active

- [ ] Performance optimization — reduce TTFB and JS bundle on public menu page
- [ ] CI/CD pipeline (lint + build + test gates)
- [ ] Fix HIGH security issues from CONCERNS.md (orders RLS, auth bypass)

### Deferred (seeds)

- SEED-001 — AI-powered tenant onboarding (text/image/menu-photo)
- SEED-002 — Customer order system (cart + addons + quantity)
- SEED-003 — Stripe Connect payments (tenant-owned accounts)
- SEED-004 — System-wide performance (full milestone, baseline done)
- SEED-005 — Marketing landing page (xmartmenu.skale.club)

### Out of Scope (v1)

- Native mobile app — web-first, responsive is sufficient
- Self-hosted Supabase — managed Supabase only for now
- Stripe integration — deferred to SEED-003

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Next.js App Router | SSR for public menu SEO + server components for data fetching | Shipped |
| Supabase RLS | Defense-in-depth multi-tenant isolation at DB layer | Shipped |
| Turbopack (default) | 2.25× faster builds than webpack | Active |
| No localStorage cart | In-memory cart for v1, matches skleanings pattern | Planned (SEED-002) |
| Stripe Connect (not platform-held) | Tenants own their Stripe account, platform takes fee | Planned (SEED-003) |
| Path-based tenant URLs (`/{slug}`) | Simple, existing pattern — namespace collision risk noted | Shipped |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements validated? → Move to Validated
2. New requirements emerged? → Add to Active
3. Key decisions made? → Add to table

---
*Last updated: 2026-05-05 after session initialization*
