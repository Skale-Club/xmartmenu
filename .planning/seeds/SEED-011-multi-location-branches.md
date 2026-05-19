---
id: SEED-011
status: completed
completed: 2026-05-19
planted: 2026-05-19
completed_in: v2.2 (Restaurant Growth Platform — phases 40-41)
planted_during: post-v2.1-custom-domains
trigger_when: a restaurant owner wants to manage multiple branches or locations under a single account
scope: medium
---

# SEED-011: Multi-Location Branches per Restaurant

## Why This Matters

Today one tenant = one restaurant = one location. Chains with 2, 3, or more units must create separate accounts, manage separate menus, and have no consolidated view of orders across branches. This is a hard blocker for any growing chain or franchise.

The fix: a `locations` table linked to the tenant, where each branch has its own address, operating hours, QR code, and optional menu customizations. The owner sees everything in one dashboard; the customer arrives via the branch-specific QR code and places an order already scoped to that location.

**Direct impact:** Opens the market to chains and franchises — accounts that generate multiple times the MRR of a solo restaurant.

## When to Surface

**Trigger:** when a tenant asks for multi-branch management, or when building chain/franchise features (consolidated reporting, franchise ops, multi-unit)

Surface during `/gsd:new-milestone` when the scope involves:
- Expansion to restaurant chains or franchises
- Consolidated management reporting
- QR codes per table/branch
- Enterprise customer onboarding

## Scope Estimate

**Medium** — 2–5 days. Components:

1. **DB migration** — `locations` table: `tenant_id`, `name`, `address`, `city`, `phone`, `operating_hours JSONB`, `is_active`, `slug`; FK + RLS policy; index on `tenant_id`
2. **Menu model** — admin chooses per-tenant: "shared menu" (all branches serve the same catalog) or "independent menus" (each branch manages its own menu). Default is shared. Implementation: `locations.menu_id FK` nullable — null means inherit tenant's default menu; populated means use branch-specific menu.
3. **Admin UI** — "Branches" section in tenant panel: location CRUD, QR code per branch
4. **Branch routing** — when no branches: tenant serves menu at root (`restaurantsite.com`); when branches exist: each branch is a path segment (`restaurantsite.com/[branch-slug]/`). QR codes point to the branch path.
5. **Root URL branch selector** — when multiple branches are active, the root URL shows a branch picker (not the menu directly); the customer selects a branch and is routed to its path
6. **KDS per branch** — filter orders by location in the KDS (kitchen A vs kitchen B)
7. **Consolidated orders view** — admin sees orders from all branches with a branch filter

## Breadcrumbs

- `src/middleware.ts` — tenant resolution; will need to load `locations` if QR uses per-branch URLs
- `supabase/migrations/` — target for `locations` migration + `orders.location_id FK`
- `src/types/database.ts` — add `Location` type
- `src/app/(admin)/settings/store/` — where the new "Branches" section lives
- `src/app/(public)/[slug]/` — public menu page that needs to accept `?location=` query param
- `src/app/(admin)/orders/` — orders view that needs the branch filter
- `src/app/(admin)/kds/` — KDS that needs to filter by `location_id`
- `src/app/api/public/orders/route.ts` — save `location_id` on order insert

## Notes

- **Menu mode is a tenant-level toggle** — "shared" (all branches use the same menu) vs "independent" (each branch has its own menu). Shared is the default. When independent is enabled, each branch gets its own `menu_id`; when switched back to shared, branch menus are detached (not deleted).
- **Independent menus reuse existing menu infrastructure** — no new tables needed; a `locations.menu_id` FK pointing to the existing `menus` table is sufficient. The public menu page already resolves by `menu_id`.
- **Branch QR codes** point to `restaurantsite.com/branch-slug/` — path-based, not query param. This gives each branch a clean, indexable URL for SEO (SEED-014 Track C).
- **Root URL behavior changes** when branches exist — root shows a branch picker page instead of the menu directly. Single-location tenants are unaffected (menu stays at root).
- **RLS** — `locations` policies should follow the same `tenant_id` pattern; staff can only access their own tenant's locations.
- **Multi-location is a natural plan-gating trigger** — consider restricting by plan (e.g. `menu` plan = 1 location; `orders` = up to 3; `payments` = unlimited) to monetize growth.
