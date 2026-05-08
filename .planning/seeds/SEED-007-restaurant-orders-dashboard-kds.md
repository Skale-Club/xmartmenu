---
id: SEED-007
status: dormant
planted: 2026-05-07
planted_during: v1.4 (Performance milestone — phase 16, frontend-performance)
trigger_when: restaurant has real order flow and the basic admin orders table is no longer enough — typically when first paying tenants start using orders in production or when SEED-003 (Stripe Connect) lands and orders become revenue-bearing
scope: medium
---

# SEED-007: Restaurant orders dashboard — KDS-style with grid/list toggle, status colors, elapsed-time timer

## Why This Matters

Today the admin orders page ([src/app/(admin)/orders/OrdersClient.tsx](src/app/(admin)/orders/OrdersClient.tsx))
is a single dense table with a tiny status pill and a static `created_at` date.
That works for "look at yesterday's orders" but **fails as a live operations
surface**: a restaurant in the middle of a lunch rush cannot scan a table to
answer the only question that matters — *which ticket is taking too long?*

The orders backend (SEED-002, completed in v1.1) is in place. The next missing
piece is the operator UX:

1. **Grid view (kitchen wall display)** — large tiles, one card per order,
   readable from across the kitchen on a tablet/TV mounted on the wall. This is
   the standard Kitchen Display System (KDS) pattern (Toast, Square, iFood).
2. **List view (manager / detail review)** — current dense table, kept for
   power users who want to scan many orders or look up history.
3. **Status color feedback** — strong, semantic background colors on each card
   so the kitchen can prioritize at a glance:
   - `pending` (new) → blue
   - `preparing` → yellow
   - `ready` → green
   - `done` → muted/grey (collapsed or hidden by default)
   - `cancelled` → red
4. **Elapsed-time chip** — counter on each card showing minutes since
   `created_at`, updating every ~30s. Color-shifts by threshold so "late"
   orders pop visually without the operator having to do mental math:
   - 0–10 min → neutral
   - 10–20 min → amber "starting to take a while"
   - 20+ min → red "this is late, investigate"
   Thresholds should be configurable per tenant (a sushi place's "late" is not
   a pizzeria's "late").

Without this, restaurant operators won't trust xmartmenu for live service —
they'll keep printing tickets or use a third-party KDS, and orders becomes a
checkbox feature instead of a daily-driver one.

## When to Surface

**Trigger:** restaurant has real order flow and the basic admin orders table is
no longer enough

This seed should be presented during `/gsd:new-milestone` when the milestone
scope matches any of these conditions:
- "KDS" / "kitchen display" / "operations" / "live orders" milestones
- Restaurant-side / tenant-side UX improvements
- Real-time / live-update features (orders dashboard needs Supabase realtime
  subscription or polling)
- Any milestone that comes after SEED-003 (Stripe Connect) ships, since paying
  customers raise the bar on the operator surface
- "First paying tenant in production" or "pilot rollout" milestones — at that
  point the current table will visibly fail under load

## Scope Estimate

**Medium** — one phase, possibly two. Builds on existing schema and API; the
work is almost entirely frontend.

Suggested phase breakdown:
1. **Phase A: dashboard UX**
   - Grid/list view toggle with persisted preference (localStorage per tenant)
   - Card component for grid view (status color, elapsed-time chip,
     customer name, item count, total, primary action button)
   - Live elapsed-time hook (`useElapsedTime(createdAt)`) updating every 30s
   - Color thresholds (constants for now; tenant settings later)
   - Auto-refresh / Supabase realtime subscription so new orders appear
     without manual reload (or polling fallback if realtime not wired)
2. **Phase B (optional follow-up): tenant-configurable thresholds + sound**
   - Settings page entries for "late" thresholds
   - Optional audible alert on new pending order (kitchen noise considered)
   - Filter chips (only pending/preparing, hide done by default)

## Breadcrumbs

### Existing implementation in xmartmenu (the *thing being upgraded*):
- [src/app/(admin)/orders/OrdersClient.tsx](src/app/(admin)/orders/OrdersClient.tsx)
  — current table-only client component. `statusColors` dict at lines 9–15
  already has the per-status palette; reuse and intensify (background, not just
  pill).
- [src/app/(admin)/orders/page.tsx](src/app/(admin)/orders/page.tsx) — server
  component fetching `orders` + `order_items`. May need to opt into Supabase
  realtime in the client.
- [src/app/api/orders/route.ts](src/app/api/orders/route.ts) — order list API
- [src/app/api/orders/[id]/route.ts](src/app/api/orders/[id]/route.ts) —
  PATCH for status transitions; already wired up in OrdersClient.
- [src/types/database.ts](src/types/database.ts) — `Order`, `OrderItem` types.
  Status enum: `pending | preparing | ready | done | cancelled`.
- [src/components/admin/AdminSidebar.tsx](src/components/admin/AdminSidebar.tsx)
  — orders entry already exists in the admin nav.

### Related seed:
- [SEED-002 (completed)](.planning/seeds/SEED-002-customer-order-system.md) —
  shipped the customer-side order flow and the orders/order_items schema this
  dashboard reads from. Section "Phase 4: Order confirmation + tenant-side
  order list" delivered the current minimal table; this seed is the proper
  follow-up to that placeholder.

## Notes

- **Realtime vs polling**: Supabase Postgres realtime on the `orders` table is
  the right primitive (one subscription per tenant filtered by `tenant_id`).
  If realtime feels heavy for v1, a 15–30s poll is acceptable — the elapsed-
  time chip already needs a tick interval, so the same loop can refetch.
- **Mobile-first**: the most likely physical device is a 10" tablet propped in
  the kitchen, not a desktop. Grid card tiles must stay legible at that size.
  List view is desktop-only really.
- **Don't overengineer**: skip drag-to-reorder, multi-station routing,
  printer integration, prep-time estimates, ETAs. Those are future seeds; v1
  is "see what's late, advance status."
- **Status terminology in PT-BR**: the user wrote in Portuguese — UI strings
  on this dashboard should ship localized (`Pendente`, `Em preparo`, `Pronto`,
  `Concluído`, `Cancelado`). i18n infra already exists in the project.
- **Performance note**: this lands after v1.4 (the active performance
  milestone). The orders dashboard will benefit from the indices in migration
  024 (status, tenant_id, created_at filters).
