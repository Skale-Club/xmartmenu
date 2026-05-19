---
id: SEED-020
status: dormant
planted: 2026-05-19
planted_during: v2.2-milestone-execution
trigger_when: restaurant activates delivery mode (SEED-013) and needs zone-based pricing and address management
scope: large
---

# SEED-020: Robust Delivery Zone System

## Why This Matters

SEED-013 adds delivery as an order type, but uses a flat delivery fee for all orders. Real delivery operations are zone-based: a customer 2 km away pays less than one 10 km away. Without zone pricing, restaurants either over-charge nearby customers (losing conversions) or under-charge distant ones (losing margin).

This seed makes delivery operationally complete:
1. **Zone-based pricing** — restaurant defines delivery zones by zipcode range or named areas, each with its own fee
2. **Address + zipcode at checkout** — structured address collection, zipcode validated against the restaurant's delivery zones
3. **Customer order panel by phone** (SEED-018 integration) — customer sees delivery status after placing an order, accessed via phone login
4. **No live GPS tracking** — out of scope; too complex and requires driver app. Status is manually updated by the restaurant (same as dine-in orders).

**Phone is the delivery anchor.** The customer provides their phone at checkout. This is how the restaurant contacts them, how the customer looks up their order status, and how the restaurant builds a customer history. Every delivery order must have `customer_phone`.

## When to Surface

**Trigger:** when a tenant activates delivery mode and needs more than a flat fee; or when building customer-facing order management

Surface during `/gsd:new-milestone` when the scope involves:
- Delivery operations
- Zone-based pricing
- Address management
- Customer order tracking by phone

## Scope Estimate

**Large** — 5–8 days. Independent phases:

### Phase A: Delivery zones — DB + admin CRUD
- New `delivery_zones` table: `(id, tenant_id, name, fee_cents, is_active)`
- New `delivery_zone_zipcodes` table: `(zone_id, zipcode TEXT)` — many zipcodes per zone
- OR simpler: `delivery_zones` with `zipcode_prefixes TEXT[]` (array of prefixes like `['1010', '1011']`) — prefix match covers ranges without enumerating every zipcode
- Admin UI: "Delivery Zones" section in settings (visible only when `delivery_enabled = true`)
  - CRUD for zones: name, fee, list of zipcodes/prefixes
  - Active/inactive toggle per zone
  - "Zipcodes not covered" warning if customer enters a zipcode outside all zones

### Phase B: Checkout address collection
- Checkout form when order_type = 'delivery': structured fields — `street_address`, `complement` (optional, e.g. apt number), `zipcode`, `city`
- On zipcode entry: real-time lookup against tenant's delivery zones
  - Match found → show zone name + fee, update cart total
  - No match → show "Delivery not available to this zipcode" + block order submission
- All address fields stored on the order: `delivery_street`, `delivery_complement`, `delivery_zipcode`, `delivery_city`
- **`customer_phone` is required for delivery orders** — field shown and validated at checkout

### Phase C: Delivery order management (restaurant side)
- KDS: delivery orders have a distinct card style — shows customer phone (masked), address, zone
- Orders view: delivery tab/filter shows full address + phone for each delivery order
- Status workflow for delivery: pending → preparing → ready → **out for delivery** → delivered
  - "Out for delivery" is a new status between ready and done — manually set by restaurant
  - Status change sends... nothing (no SMS/push in v1 — customer tracks via panel)
- Orders export: delivery orders include full address in export

### Phase D: Customer order status panel (SEED-018 integration)
- At `restaurantsite.com/me` (customer panel from SEED-018), delivery orders show:
  - Order status with the full workflow (preparing → ready → out for delivery → delivered)
  - Estimated delivery time (if restaurant sets it on the order)
  - Items ordered + total paid
  - Restaurant address + phone (so customer can call if needed)
- Customer accesses panel by logging in with their phone (SEED-018 OTP)
- No live GPS — status is just the manually-updated order status field
- Customer can optionally add a delivery note: "leave at door", "call on arrival"

### Phase E: Flat fee fallback (SEED-013 compatibility)
- If restaurant has `delivery_enabled = true` but no delivery zones configured → fall back to the flat `delivery_fee_cents` from SEED-013
- This keeps SEED-013 working for simple restaurants; SEED-020 is the upgrade path
- Admin UI shows a banner: "You're using a flat delivery fee. Set up delivery zones for zone-based pricing."

## Breadcrumbs

- `supabase/migrations/` — `delivery_zones`, `delivery_zone_zipcodes`, new columns on `orders` (`delivery_street`, `delivery_complement`, `delivery_zipcode`, `delivery_city`, `customer_phone` if not added by SEED-018)
- `src/types/database.ts` — `DeliveryZone`, extended `Order` type
- `src/components/menu/CartModal.tsx` — delivery address form + zipcode zone lookup
- `src/app/api/public/orders/route.ts` — validate zipcode against zones before insert, store address fields
- `src/app/api/admin/delivery-zones/route.ts` — new CRUD endpoint for zone management
- `src/app/(admin)/settings/store/StoreClient.tsx` — Delivery Zones section
- `src/app/(admin)/kds/` — delivery order card variant
- `src/app/(admin)/orders/` — delivery address + phone in order detail
- `src/app/(public)/[slug]/me/` — customer panel delivery status (SEED-018 integration)
- `src/app/api/admin/orders/[id]/route.ts` — PATCH to set "out for delivery" status

## Notes

- **Depends on SEED-013 (order types)** — delivery must be enabled before zones are relevant.
- **Depends on SEED-018 (customer phone login)** — the customer panel and phone requirement on delivery orders both need SEED-018.
- **Zipcode prefix matching is the right v1 model** — storing exact zipcodes is brittle (cities have hundreds). Prefixes like `'1010'` match `10100-000`, `10101-000`, etc. covering a whole district. Restaurant admins set "Zone A = prefixes 1010, 1011, 1012" and it works.
- **`customer_phone` is mandatory for delivery** — validate at checkout. No phone = no delivery order. This is the data that lets the restaurant call if there's a problem and lets the customer track via the panel.
- **Delivery note field** — store as `delivery_notes TEXT` on orders; shown to restaurant in KDS and orders view.
- **No SMS/push notifications in v1** — customer tracks via the panel by logging in with their phone. SMS notifications (order confirmed, out for delivery) are a future seed.
- **SEED-017 (tips)** coordinate: `total_cents = items_total + delivery_fee_cents + tip_cents`. Delivery fee comes from the matched zone (not the flat fee) when zones are configured.
- **SEED-011 (multi-location)** coordinate: when branches are active, delivery zones are per-branch — each branch serves its own geographic area. The `delivery_zones` table should have `location_id FK` (nullable = applies to single-location tenant).
