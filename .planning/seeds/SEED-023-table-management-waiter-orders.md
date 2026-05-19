---
id: SEED-023
status: complete
planted: 2026-05-19
planted_during: v2.2-milestone-execution
trigger_when: restaurant uses table service and wants waiters to take orders tied to specific tables
scope: medium
---

# SEED-023: Table Management + Waiter Order Entry

## Why This Matters

Today XmartMenu assumes a self-service model: the customer scans a QR, browses the menu, and places their own order. Many full-service restaurants work differently — a waiter goes to the table, takes the order verbally or on a notepad, and then enters it into the system. Without table numbers, the kitchen sees anonymous orders with no way to know which table to deliver to.

**Critical design constraint:** table assignment is the waiter's responsibility, never the customer's. The customer should not need to enter, select, or even see a table number. The QR code on the table is just a shortcut for the waiter — the system does not expose table selection to customers at any point.

**The flow:**
1. Restaurant enables "Table Management" in settings and defines their table list (Table 1–20, Patio A, Bar 1, etc.)
2. Waiter arrives at a table, opens the restaurant's ordering interface on their device (tablet, phone)
3. Waiter selects the table number from a picker, then enters the order on behalf of the customer
4. Order is placed with `table_number` stamped on it
5. Kitchen sees the table number prominently on every KDS card
6. Table status view shows which tables are occupied (have active orders)

**What this is NOT:**
- Not a QR-per-table customer self-ordering system (that's the current flow, unchanged)
- Not a reservation system
- Not a split-bill or multi-seat ordering system
- Not the customer's problem in any way

## When to Surface

**Trigger:** when full-service restaurants request table order tracking, or when building a waiter-facing interface

Surface during `/gsd:new-milestone` when the scope involves:
- Table service restaurant support
- Waiter-facing tools
- KDS improvements (table number on orders)
- Front-of-house + back-of-house coordination

## Scope Estimate

**Medium** — 3–5 days. Four independent phases:

### Phase A: Table configuration + DB
- `tenant_settings`: add `table_management_enabled BOOLEAN DEFAULT false`
- New `tables` table: `(id, tenant_id, name TEXT, capacity INT, is_active BOOLEAN DEFAULT true, display_order INT)`
  - `name` is free text: "1", "2", "Patio A", "Bar 1", "VIP Lounge" — the restaurant defines their own naming
  - `capacity` is optional (for future table status / occupancy display)
- `orders`: add `table_name TEXT` (nullable — null for pick-up, delivery, or self-service dine-in orders)
- RLS: same `tenant_id` isolation
- Admin UI: "Tables" section in settings (visible only when `table_management_enabled = true`)
  - CRUD: add/edit/deactivate tables, drag-and-drop reorder
  - Quick-add: "Add 20 tables" button that generates Table 1–N in bulk

### Phase B: Waiter order entry interface
- New route: `restaurantsite.com/waiter` (or `xmartmenu.skale.club/[slug]/waiter`)
- Accessible only by logged-in staff (`store-admin` or `store-staff` role)
- Interface flow:
  1. **Select table** — grid of active tables, large touch targets; show occupied vs available status
  2. **Browse menu + add items** — simplified version of the public menu (same products, same options, no branding chrome)
  3. **Review order** — items, quantities, notes, table confirmed
  4. **Place order** — submits via the same `POST /api/public/orders` route with `table_name` in payload
- The waiter interface is optimized for speed: large buttons, minimal scrolling, quick option selection
- Works on any device (phone, tablet) via responsive layout
- Waiter can add multiple orders to the same table (e.g., adding desserts after the main course)

### Phase C: KDS + orders view integration
- KDS order card: table name displayed prominently — large, above the item list
  - Color-coded or badged: dine-in table orders vs pick-up vs delivery all visually distinct
  - "Table 5" or "Patio A" on the card header, not buried in the details
- KDS filter: filter by table name (useful for large restaurants tracking a specific area)
- Orders view: `table_name` column in the admin orders list
- Orders view filter: filter by table name to see the full history of a table's orders during a service

### Phase D: Table status view
- New section in the admin panel (or a dedicated screen): live table occupancy map
- Shows each table as a tile: green = available, amber = has active orders, red = all items delivered (table needs clearing)
- Clicking a table shows its active orders
- Status driven by order states: if any order for that table has `status != done/cancelled`, table is occupied
- Useful for the floor manager to see which tables need attention without going to the KDS

## Breadcrumbs

- `supabase/migrations/` — `tables` table, `tenant_settings.table_management_enabled`, `orders.table_name`
- `src/types/database.ts` — `Table` type, `TenantSettings` + `Order` extended
- `src/app/(admin)/settings/store/StoreClient.tsx` — "Tables" section when enabled
- `src/app/(admin)/tables/` — table management page (CRUD)
- `src/app/(public)/[slug]/waiter/` — waiter order entry interface (auth-gated to staff)
- `src/app/api/public/orders/route.ts` — accept `table_name` in order payload
- `src/app/(admin)/kds/` — table name on order cards + filter
- `src/app/(admin)/orders/` — table_name column + filter
- `src/middleware.ts` — `/waiter` route accessible to authenticated staff only

## Notes

- **Feature is opt-in and isolated** — `table_management_enabled = false` by default. Existing tenants and self-service flows are completely unaffected. `orders.table_name` is nullable so anonymous orders keep working.
- **Table name is free text on the order** — we store the name as a string, not a FK to the `tables` table. This means if a table is renamed or deleted, historical orders retain the original name they were placed under. No orphaned FK issues.
- **Waiter interface is staff-only** — it's a staff tool, not a customer tool. The route must be behind Supabase Auth middleware checking `store-admin` or `store-staff` role. A customer navigating to `/waiter` gets redirected to the public menu.
- **Same order API, different source** — the waiter places orders via the same `POST /api/public/orders` endpoint the customer uses. The `table_name` field is added to the payload. No separate "waiter orders" API needed.
- **SEED-013 (order types)** coordinate: waiter orders placed for a table are always `dine_in`. The `order_type` and `table_name` fields coexist naturally on the order.
- **SEED-011 (multi-location)** coordinate: tables are per-location when branches are active. `tables.location_id FK` (nullable = single-location tenant).
- **Future: QR shortcut per table** — the waiter could scan a physical QR on the table that pre-selects that table in the waiter interface, bypassing the table picker step. This is a UX enhancement, not an architectural change. The URL pattern would be `restaurantsite.com/waiter?table=5` — the interface pre-selects `table_name = "5"` and skips to the menu directly.
